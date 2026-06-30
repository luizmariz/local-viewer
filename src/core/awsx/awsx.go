// Package awsx talks to AWS-compatible endpoints (LocalStack, Garage, …) and
// exposes the viewer's HTTP API. It mirrors the Node prototype's behaviour.
package awsx

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/cloudformation"
	cftypes "github.com/aws/aws-sdk-go-v2/service/cloudformation/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/luizmariz/local-viewer/src/core/sse"
)

// Conn identifies an AWS-compatible target.
type Conn struct {
	Endpoint  string
	Region    string
	AccessKey string
	SecretKey string
}

type clients struct {
	s3 *s3.Client
	sq *sqs.Client
	cf *cloudformation.Client
}

// Resolver maps a saved connection id to a Conn (implemented by the store).
type Resolver interface {
	Resolve(id string) (Conn, bool)
}

// API holds config + a per-connection client cache.
type API struct {
	Default  Conn
	PeekN    int32
	Resolver Resolver
	log      *sse.Hub

	mu    sync.Mutex
	cache map[Conn]*clients
}

func New(def Conn, peek int, log *sse.Hub) *API {
	if peek <= 0 {
		peek = 5
	}
	return &API{Default: def, PeekN: int32(peek), log: log, cache: map[Conn]*clients{}}
}

func (a *API) clients(c Conn) *clients {
	if c.Endpoint == "" {
		c.Endpoint = a.Default.Endpoint
	}
	if c.Region == "" {
		c.Region = a.Default.Region
	}
	if c.AccessKey == "" {
		c.AccessKey, c.SecretKey = a.Default.AccessKey, a.Default.SecretKey
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if cl, ok := a.cache[c]; ok {
		return cl
	}
	cfg := aws.Config{Region: c.Region, Credentials: credentials.NewStaticCredentialsProvider(c.AccessKey, c.SecretKey, "")}
	cl := &clients{
		s3: s3.NewFromConfig(cfg, func(o *s3.Options) { o.BaseEndpoint = aws.String(c.Endpoint); o.UsePathStyle = true }),
		sq: sqs.NewFromConfig(cfg, func(o *sqs.Options) { o.BaseEndpoint = aws.String(c.Endpoint) }),
		cf: cloudformation.NewFromConfig(cfg, func(o *cloudformation.Options) { o.BaseEndpoint = aws.String(c.Endpoint) }),
	}
	a.cache[c] = cl
	return cl
}

// ---- shapes returned to the SPA (JSON field names matter) ----

type bucket struct {
	Name    string     `json:"name"`
	Created *time.Time `json:"created"`
}
type object struct {
	Key          string     `json:"key"`
	Size         int64      `json:"size"`
	LastModified *time.Time `json:"lastModified"`
}
type qattrs struct {
	Visible int `json:"visible"`
	InFlight int `json:"inFlight"`
	Delayed int `json:"delayed"`
}
type message struct {
	ID           string `json:"id"`
	ReceiveCount int    `json:"receiveCount"`
	SentAt       int64  `json:"sentAt"`
	Group        any    `json:"group"`
	Body         any    `json:"body"`
}
type queue struct {
	URL           string     `json:"url"`
	Name          string     `json:"name"`
	Kind          string     `json:"kind"`
	Attrs         *qattrs    `json:"attrs"`
	Messages      []message  `json:"messages"`
	Arn           any        `json:"arn"`
	RedrivePolicy any        `json:"redrivePolicy"`
}
type changeset struct {
	StackName       string     `json:"stackName"`
	StackID         string     `json:"stackId"`
	ChangeSetName   string     `json:"changeSetName"`
	ChangeSetID     string     `json:"changeSetId"`
	Status          string     `json:"status"`
	ExecutionStatus string     `json:"executionStatus"`
	CreationTime    *time.Time `json:"creationTime"`
	Description     any        `json:"description"`
}

func queueKind(name string) string {
	switch {
	case strings.Contains(name, "-dlq-"):
		return "dlq"
	case strings.HasSuffix(name, ".fifo"):
		return "fifo"
	default:
		return "standard"
	}
}

func parseBody(s string) any {
	t := strings.TrimSpace(s)
	if (strings.HasPrefix(t, "{") || strings.HasPrefix(t, "[")) && json.Valid([]byte(t)) {
		return json.RawMessage(t)
	}
	return s
}

func (a *API) listBuckets(ctx context.Context, c Conn) []bucket {
	out, err := a.clients(c).s3.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil
	}
	res := make([]bucket, 0, len(out.Buckets))
	for _, b := range out.Buckets {
		res = append(res, bucket{Name: aws.ToString(b.Name), Created: b.CreationDate})
	}
	return res
}

func (a *API) listObjects(ctx context.Context, c Conn, bkt string) []object {
	if bkt == "" {
		return []object{}
	}
	out, err := a.clients(c).s3.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(bkt)})
	if err != nil {
		return nil
	}
	res := make([]object, 0, len(out.Contents))
	for _, o := range out.Contents {
		res = append(res, object{Key: aws.ToString(o.Key), Size: aws.ToInt64(o.Size), LastModified: o.LastModified})
	}
	return res
}

func (a *API) listQueueURLs(ctx context.Context, c Conn) ([]string, bool) {
	out, err := a.clients(c).sq.ListQueues(ctx, &sqs.ListQueuesInput{})
	if err != nil {
		return nil, false
	}
	urls := append([]string(nil), out.QueueUrls...)
	sort.Strings(urls)
	return urls, true
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

func (a *API) queueDetail(ctx context.Context, c Conn, url string) queue {
	cl := a.clients(c)
	name := url[strings.LastIndex(url, "/")+1:]
	q := queue{URL: url, Name: name, Kind: queueKind(name)}

	attrs, err := cl.sq.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl: aws.String(url),
		AttributeNames: []sqstypes.QueueAttributeName{
			"ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible",
			"ApproximateNumberOfMessagesDelayed", "QueueArn", "RedrivePolicy",
		},
	})
	if err == nil {
		m := attrs.Attributes
		q.Attrs = &qattrs{
			Visible:  atoi(m["ApproximateNumberOfMessages"]),
			InFlight: atoi(m["ApproximateNumberOfMessagesNotVisible"]),
			Delayed:  atoi(m["ApproximateNumberOfMessagesDelayed"]),
		}
		if v, ok := m["QueueArn"]; ok {
			q.Arn = v
		}
		if v, ok := m["RedrivePolicy"]; ok && v != "" {
			q.RedrivePolicy = json.RawMessage(v)
		}
	}

	peek, err := cl.sq.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
		QueueUrl:              aws.String(url),
		MaxNumberOfMessages:   a.PeekN,
		VisibilityTimeout:     0,
		MessageSystemAttributeNames: []sqstypes.MessageSystemAttributeName{"SentTimestamp", "MessageGroupId", "ApproximateReceiveCount"},
	})
	if err == nil {
		for _, m := range peek.Messages {
			msg := message{ID: aws.ToString(m.MessageId), ReceiveCount: 1, Body: parseBody(aws.ToString(m.Body))}
			if v := m.Attributes["ApproximateReceiveCount"]; v != "" {
				msg.ReceiveCount = atoi(v)
			}
			if v := m.Attributes["SentTimestamp"]; v != "" {
				msg.SentAt, _ = strconv.ParseInt(v, 10, 64)
			}
			if v := m.Attributes["MessageGroupId"]; v != "" {
				msg.Group = v
			}
			q.Messages = append(q.Messages, msg)
		}
	}
	return q
}

// State is the payload for GET /api/state.
type State struct {
	Timestamp  string      `json:"timestamp"`
	Endpoint   string      `json:"endpoint"`
	Bucket     string      `json:"bucket"`
	Buckets    []bucket    `json:"buckets"`
	Queues     []queue     `json:"queues"`
	Objects    []object    `json:"objects"`
	Changesets []changeset `json:"changesets"`
}

func (a *API) buildState(ctx context.Context, c Conn) State {
	st := State{Timestamp: time.Now().UTC().Format(time.RFC3339), Endpoint: c.Endpoint, Objects: []object{}}
	st.Buckets = a.listBuckets(ctx, c)
	if urls, ok := a.listQueueURLs(ctx, c); ok {
		qs := make([]queue, len(urls))
		var wg sync.WaitGroup
		for i, u := range urls {
			wg.Add(1)
			go func(i int, u string) { defer wg.Done(); qs[i] = a.queueDetail(ctx, c, u) }(i, u)
		}
		wg.Wait()
		st.Queues = qs
	}
	st.Changesets = a.listPendingChangesets(ctx, c)
	return st
}

func (a *API) listPendingChangesets(ctx context.Context, c Conn) []changeset {
	cl := a.clients(c)
	var res []changeset
	filter := []cftypes.StackStatus{
		"CREATE_IN_PROGRESS", "CREATE_COMPLETE", "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE",
		"UPDATE_ROLLBACK_COMPLETE", "REVIEW_IN_PROGRESS", "IMPORT_COMPLETE",
	}
	var token *string
	for {
		out, err := cl.cf.ListStacks(ctx, &cloudformation.ListStacksInput{NextToken: token, StackStatusFilter: filter})
		if err != nil {
			return res
		}
		for _, s := range out.StackSummaries {
			id := aws.ToString(s.StackId)
			cs, err := cl.cf.ListChangeSets(ctx, &cloudformation.ListChangeSetsInput{StackName: aws.String(id)})
			if err != nil {
				continue
			}
			for _, x := range cs.Summaries {
				if x.ExecutionStatus == "AVAILABLE" && (x.Status == "CREATE_COMPLETE" || x.Status == "CREATE_PENDING") {
					res = append(res, changeset{
						StackName: aws.ToString(s.StackName), StackID: id,
						ChangeSetName: aws.ToString(x.ChangeSetName), ChangeSetID: aws.ToString(x.ChangeSetId),
						Status: string(x.Status), ExecutionStatus: string(x.ExecutionStatus),
						CreationTime: x.CreationTime, Description: aws.ToString(x.Description),
					})
				}
			}
		}
		if out.NextToken == nil {
			return res
		}
		token = out.NextToken
	}
}

// readObject returns preview metadata. It only inlines the bytes for genuine
// UTF-8 text/JSON; images and binary report their type/size/content-type so the
// UI can render an <img>/download via /api/object/raw instead of dumping bytes.
func (a *API) readObject(ctx context.Context, c Conn, bkt, key string) any {
	out, err := a.clients(c).s3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bkt), Key: aws.String(key)})
	if err != nil {
		return nil
	}
	defer out.Body.Close()
	b, err := io.ReadAll(out.Body)
	if err != nil {
		return nil
	}
	ct := aws.ToString(out.ContentType)
	if ct == "" {
		ct = http.DetectContentType(b)
	}
	meta := map[string]any{"contentType": ct, "size": len(b)}
	switch {
	case strings.HasPrefix(ct, "image/"):
		meta["type"] = "image"
	case len(b) <= 2<<20 && utf8.Valid(b) && !bytes.Contains(b, []byte{0}):
		t := strings.TrimSpace(string(b))
		if (strings.HasPrefix(t, "{") || strings.HasPrefix(t, "[")) && json.Valid([]byte(t)) {
			meta["type"], meta["value"] = "json", json.RawMessage(t)
		} else {
			meta["type"], meta["value"] = "text", string(b)
		}
	default:
		meta["type"] = "binary"
	}
	return meta
}

// getObjectRaw returns the object bytes + content type (for image/download serving).
func (a *API) getObjectRaw(ctx context.Context, c Conn, bkt, key string) ([]byte, string, error) {
	out, err := a.clients(c).s3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bkt), Key: aws.String(key)})
	if err != nil {
		return nil, "", err
	}
	defer out.Body.Close()
	b, err := io.ReadAll(out.Body)
	if err != nil {
		return nil, "", err
	}
	ct := aws.ToString(out.ContentType)
	if ct == "" {
		ct = http.DetectContentType(b)
	}
	return b, ct, nil
}

func (a *API) putObject(ctx context.Context, c Conn, bkt, key, body, contentType string) error {
	if contentType == "" {
		contentType = "text/plain; charset=utf-8"
	}
	_, err := a.clients(c).s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bkt), Key: aws.String(key),
		Body: strings.NewReader(body), ContentType: aws.String(contentType),
	})
	return err
}

func (a *API) putObjectBytes(ctx context.Context, c Conn, bkt, key string, data []byte, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := a.clients(c).s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bkt), Key: aws.String(key),
		Body: bytes.NewReader(data), ContentLength: aws.Int64(int64(len(data))), ContentType: aws.String(contentType),
	})
	return err
}

func (a *API) deleteObject(ctx context.Context, c Conn, bkt, key string) error {
	_, err := a.clients(c).s3.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bkt), Key: aws.String(key)})
	return err
}

func (a *API) purgeQueue(ctx context.Context, c Conn, url string) error {
	_, err := a.clients(c).sq.PurgeQueue(ctx, &sqs.PurgeQueueInput{QueueUrl: aws.String(url)})
	return err
}

func (a *API) findSourceForDLQ(ctx context.Context, c Conn, dlqArn string, urls []string) string {
	cl := a.clients(c)
	for _, u := range urls {
		out, err := cl.sq.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{QueueUrl: aws.String(u), AttributeNames: []sqstypes.QueueAttributeName{"RedrivePolicy"}})
		if err != nil {
			continue
		}
		rp := out.Attributes["RedrivePolicy"]
		if rp == "" {
			continue
		}
		var p struct {
			DeadLetterTargetArn string `json:"deadLetterTargetArn"`
		}
		if json.Unmarshal([]byte(rp), &p) == nil && p.DeadLetterTargetArn == dlqArn {
			return u
		}
	}
	return ""
}

func (a *API) redriveDLQ(ctx context.Context, c Conn, dlqURL string) (int, string, error) {
	cl := a.clients(c)
	attrs, err := cl.sq.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{QueueUrl: aws.String(dlqURL), AttributeNames: []sqstypes.QueueAttributeName{"QueueArn"}})
	if err != nil {
		return 0, "", err
	}
	dlqArn := attrs.Attributes["QueueArn"]
	urls, _ := a.listQueueURLs(ctx, c)
	src := a.findSourceForDLQ(ctx, c, dlqArn, urls)
	if src == "" {
		return 0, "", errString("no source queue points at this DLQ (no RedrivePolicy match)")
	}
	isFifo := strings.HasSuffix(src, ".fifo")
	moved, empty := 0, 0
	for empty < 3 {
		recv, err := cl.sq.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl: aws.String(dlqURL), MaxNumberOfMessages: 10, VisibilityTimeout: 30, WaitTimeSeconds: 0,
			MessageSystemAttributeNames: []sqstypes.MessageSystemAttributeName{"MessageGroupId", "MessageDeduplicationId"},
		})
		if err != nil {
			return moved, src, err
		}
		if len(recv.Messages) == 0 {
			empty++
			continue
		}
		empty = 0
		for _, m := range recv.Messages {
			in := &sqs.SendMessageInput{QueueUrl: aws.String(src), MessageBody: m.Body}
			if isFifo {
				g := m.Attributes["MessageGroupId"]
				if g == "" {
					g = "redrive"
				}
				in.MessageGroupId = aws.String(g)
			}
			if _, err := cl.sq.SendMessage(ctx, in); err != nil {
				return moved, src, err
			}
			if _, err := cl.sq.DeleteMessage(ctx, &sqs.DeleteMessageInput{QueueUrl: aws.String(dlqURL), ReceiptHandle: m.ReceiptHandle}); err != nil {
				return moved, src, err
			}
			moved++
		}
	}
	return moved, src, nil
}

func (a *API) executeChangeset(ctx context.Context, c Conn, stackRef, csName string) error {
	_, err := a.clients(c).cf.ExecuteChangeSet(ctx, &cloudformation.ExecuteChangeSetInput{StackName: aws.String(stackRef), ChangeSetName: aws.String(csName)})
	return err
}

type errString string

func (e errString) Error() string { return string(e) }
