// Package dockerx is a lean Docker client + API for the Docker view. It speaks
// the Docker Engine HTTP API over the unix socket using only the standard
// library (no Docker SDK), keeping the build dependency-light and CGO-free.
//
// Scope is deliberately small — the Portainer essentials people actually use:
// list / start / stop / restart / remove containers, tail logs, list & remove
// images. No deep features.
package dockerx

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/luizmariz/local-viewer/src/core/sse"
)

type Client struct {
	host string
	hub  *sse.Hub
	hc   *http.Client

	statsMu sync.Mutex
	stats   map[string]statEntry // container id -> last sampled stats
}

type statEntry struct {
	at  time.Time
	cpu float64
	mem int64
	lim int64
}

const statsTTL = 2500 * time.Millisecond

func New(host string, hub *sse.Hub) *Client {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 5 * time.Second}
			return d.DialContext(ctx, "unix", host)
		},
	}
	return &Client{host: host, hub: hub, hc: &http.Client{Transport: tr, Timeout: 20 * time.Second}, stats: map[string]statEntry{}}
}

func (c *Client) do(ctx context.Context, method, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, nil)
	if err != nil {
		return nil, err
	}
	return c.hc.Do(req)
}

func (c *Client) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/docker/info", c.info)
	mux.HandleFunc("GET /api/docker/containers", c.listContainers)
	mux.HandleFunc("POST /api/docker/start-all", c.startAll)
	mux.HandleFunc("POST /api/docker/containers/{id}/{action}", c.containerAction)
	mux.HandleFunc("DELETE /api/docker/containers/{id}", c.removeContainer)
	mux.HandleFunc("GET /api/docker/containers/{id}/logs", c.containerLogs)
	mux.HandleFunc("GET /api/docker/containers/{id}/inspect", c.containerInspect)
	mux.HandleFunc("GET /api/docker/images", c.listImages)
	mux.HandleFunc("DELETE /api/docker/images/{id}", c.removeImage)
	mux.HandleFunc("GET /api/docker/volumes", c.listVolumes)
	mux.HandleFunc("DELETE /api/docker/volumes/{name}", c.removeVolume)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (c *Client) info(w http.ResponseWriter, r *http.Request) {
	res, err := c.do(r.Context(), "GET", "/version")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "error": err.Error()})
		return
	}
	defer res.Body.Close()
	var v map[string]any
	_ = json.NewDecoder(res.Body).Decode(&v)
	writeJSON(w, http.StatusOK, map[string]any{"available": res.StatusCode == 200, "version": v["Version"], "apiVersion": v["ApiVersion"]})
}

type container struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Image    string   `json:"image"`
	State    string   `json:"state"`
	Status   string   `json:"status"`
	Ports    []string `json:"ports"`
	Created  int64    `json:"created"`
	CPU      float64  `json:"cpu"`      // percent, -1 when unknown
	MemUsage int64    `json:"memUsage"` // bytes
	MemLimit int64    `json:"memLimit"` // bytes
}

func (c *Client) listContainers(w http.ResponseWriter, r *http.Request) {
	res, err := c.do(r.Context(), "GET", "/containers/json?all=1")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	var raw []struct {
		Id      string
		Names   []string
		Image   string
		State   string
		Status  string
		Created int64
		Ports   []struct {
			PrivatePort int
			PublicPort  int
			Type        string
		}
	}
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	out := make([]container, len(raw))
	var wg sync.WaitGroup
	for i, rc := range raw {
		name := ""
		if len(rc.Names) > 0 {
			name = strings.TrimPrefix(rc.Names[0], "/")
		}
		ports := []string{}
		for _, p := range rc.Ports {
			if p.PublicPort > 0 {
				ports = append(ports, itoa(p.PublicPort)+"→"+itoa(p.PrivatePort)+"/"+p.Type)
			} else if p.PrivatePort > 0 {
				ports = append(ports, itoa(p.PrivatePort)+"/"+p.Type)
			}
		}
		cn := container{ID: rc.Id, Name: name, Image: rc.Image, State: rc.State, Status: rc.Status, Ports: ports, Created: rc.Created, CPU: -1}
		out[i] = cn
		if rc.State == "running" {
			wg.Add(1)
			go func(i int, id string) {
				defer wg.Done()
				if cpu, mem, lim, ok := c.sampleStats(r.Context(), id); ok {
					out[i].CPU, out[i].MemUsage, out[i].MemLimit = cpu, mem, lim
				}
			}(i, rc.Id)
		}
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"containers": out})
}

// sampleStats returns cpu% / mem usage / mem limit for a container, served from
// a short-lived cache so frequent list refreshes don't hammer the daemon.
func (c *Client) sampleStats(ctx context.Context, id string) (float64, int64, int64, bool) {
	c.statsMu.Lock()
	if e, ok := c.stats[id]; ok && time.Since(e.at) < statsTTL {
		c.statsMu.Unlock()
		return e.cpu, e.mem, e.lim, true
	}
	c.statsMu.Unlock()

	res, err := c.do(ctx, "GET", "/containers/"+id+"/stats?stream=false&one-shot=false")
	if err != nil {
		return -1, 0, 0, false
	}
	defer res.Body.Close()
	var s struct {
		CPUStats struct {
			CPUUsage struct {
				TotalUsage  int64   `json:"total_usage"`
				PercpuUsage []int64 `json:"percpu_usage"`
			} `json:"cpu_usage"`
			SystemUsage int64 `json:"system_cpu_usage"`
			OnlineCPUs  int   `json:"online_cpus"`
		} `json:"cpu_stats"`
		PreCPUStats struct {
			CPUUsage struct {
				TotalUsage int64 `json:"total_usage"`
			} `json:"cpu_usage"`
			SystemUsage int64 `json:"system_cpu_usage"`
		} `json:"precpu_stats"`
		MemoryStats struct {
			Usage int64            `json:"usage"`
			Limit int64            `json:"limit"`
			Stats map[string]int64 `json:"stats"`
		} `json:"memory_stats"`
	}
	if err := json.NewDecoder(res.Body).Decode(&s); err != nil {
		return -1, 0, 0, false
	}
	cpu := 0.0
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage - s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage - s.PreCPUStats.SystemUsage)
	cpus := s.CPUStats.OnlineCPUs
	if cpus == 0 {
		cpus = len(s.CPUStats.CPUUsage.PercpuUsage)
	}
	if cpus == 0 {
		cpus = 1
	}
	if cpuDelta > 0 && sysDelta > 0 {
		cpu = (cpuDelta / sysDelta) * float64(cpus) * 100.0
	}
	mem := s.MemoryStats.Usage
	if cache, ok := s.MemoryStats.Stats["inactive_file"]; ok && cache <= mem {
		mem -= cache // mirror `docker stats` (exclude page cache)
	}
	c.statsMu.Lock()
	c.stats[id] = statEntry{at: time.Now(), cpu: cpu, mem: mem, lim: s.MemoryStats.Limit}
	c.statsMu.Unlock()
	return cpu, mem, s.MemoryStats.Limit, true
}

// startAll starts every non-running container.
func (c *Client) startAll(w http.ResponseWriter, r *http.Request) {
	res, err := c.do(r.Context(), "GET", "/containers/json?all=1")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	var raw []struct {
		Id    string
		State string
	}
	_ = json.NewDecoder(res.Body).Decode(&raw)
	res.Body.Close()
	c.hub.Log("info", "docker start-all requested", nil)
	started := 0
	for _, rc := range raw {
		if rc.State == "running" {
			continue
		}
		r2, err := c.do(r.Context(), "POST", "/containers/"+rc.Id+"/start")
		if err != nil {
			continue
		}
		if r2.StatusCode < 300 {
			started++
		}
		r2.Body.Close()
	}
	c.hub.Log("ok", "docker started "+itoa(started)+" container(s)", nil)
	writeJSON(w, http.StatusOK, map[string]any{"started": started})
}

func (c *Client) containerAction(w http.ResponseWriter, r *http.Request) {
	id, action := r.PathValue("id"), r.PathValue("action")
	if action != "start" && action != "stop" && action != "restart" {
		fail(w, http.StatusBadRequest, errString("unknown action"))
		return
	}
	c.hub.Log("info", "docker "+action+" "+short(id), nil)
	res, err := c.do(r.Context(), "POST", "/containers/"+id+"/"+action)
	if err != nil {
		c.hub.Log("error", "docker "+action+" failed", map[string]string{"error": err.Error()})
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		c.hub.Log("error", "docker "+action+" failed", map[string]string{"error": strings.TrimSpace(string(b))})
		fail(w, res.StatusCode, errString(strings.TrimSpace(string(b))))
		return
	}
	c.hub.Log("ok", "docker "+action+" "+short(id), nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (c *Client) removeContainer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c.hub.Log("info", "docker remove "+short(id), nil)
	res, err := c.do(r.Context(), "DELETE", "/containers/"+id+"?force=1")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		fail(w, res.StatusCode, errString(strings.TrimSpace(string(b))))
		return
	}
	c.hub.Log("ok", "docker removed "+short(id), nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (c *Client) containerLogs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tail := r.URL.Query().Get("tail")
	if tail == "" {
		tail = "200"
	}
	res, err := c.do(r.Context(), "GET", "/containers/"+id+"/logs?stdout=1&stderr=1&tail="+tail)
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	text := demux(res.Body)
	writeJSON(w, http.StatusOK, map[string]any{"logs": text})
}

// containerInspect returns the container's environment variables (and a few
// config bits) from `docker inspect`.
func (c *Client) containerInspect(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	res, err := c.do(r.Context(), "GET", "/containers/"+id+"/json")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	var ins struct {
		Config struct {
			Env        []string `json:"Env"`
			Cmd        []string `json:"Cmd"`
			Entrypoint []string `json:"Entrypoint"`
			WorkingDir string   `json:"WorkingDir"`
		} `json:"Config"`
	}
	if err := json.NewDecoder(res.Body).Decode(&ins); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"env": ins.Config.Env, "cmd": ins.Config.Cmd,
		"entrypoint": ins.Config.Entrypoint, "workingDir": ins.Config.WorkingDir,
	})
}

type image struct {
	ID      string   `json:"id"`
	Tags    []string `json:"tags"`
	Size    int64    `json:"size"`
	Created int64    `json:"created"`
	UsedBy  []string `json:"usedBy"`
}

// containerRefs maps volume names and image refs to the containers using them.
func (c *Client) containerRefs(ctx context.Context) (vol map[string][]string, img map[string][]string) {
	vol, img = map[string][]string{}, map[string][]string{}
	res, err := c.do(ctx, "GET", "/containers/json?all=1")
	if err != nil {
		return
	}
	defer res.Body.Close()
	var raw []struct {
		Names   []string
		Image   string
		ImageID string
		Mounts  []struct {
			Type string
			Name string
		}
	}
	if json.NewDecoder(res.Body).Decode(&raw) != nil {
		return
	}
	for _, rc := range raw {
		name := ""
		if len(rc.Names) > 0 {
			name = strings.TrimPrefix(rc.Names[0], "/")
		}
		for _, m := range rc.Mounts {
			if m.Type == "volume" && m.Name != "" {
				vol[m.Name] = appendUniq(vol[m.Name], name)
			}
		}
		if rc.ImageID != "" {
			img[rc.ImageID] = appendUniq(img[rc.ImageID], name)
		}
		if rc.Image != "" {
			img[rc.Image] = appendUniq(img[rc.Image], name)
		}
	}
	return
}

func appendUniq(s []string, v string) []string {
	if v == "" {
		return s
	}
	for _, x := range s {
		if x == v {
			return s
		}
	}
	return append(s, v)
}

func (c *Client) listImages(w http.ResponseWriter, r *http.Request) {
	res, err := c.do(r.Context(), "GET", "/images/json")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	var raw []struct {
		Id       string
		RepoTags []string
		Size     int64
		Created  int64
	}
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	_, imgRefs := c.containerRefs(r.Context())
	out := make([]image, 0, len(raw))
	for _, im := range raw {
		used := append([]string(nil), imgRefs[im.Id]...)
		for _, tag := range im.RepoTags {
			for _, n := range imgRefs[tag] {
				used = appendUniq(used, n)
			}
		}
		out = append(out, image{ID: im.Id, Tags: im.RepoTags, Size: im.Size, Created: im.Created, UsedBy: used})
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": out})
}

func (c *Client) removeImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c.hub.Log("info", "docker rmi "+short(id), nil)
	res, err := c.do(r.Context(), "DELETE", "/images/"+id+"?force=1")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		c.hub.Log("error", "docker rmi failed", map[string]string{"error": strings.TrimSpace(string(b))})
		fail(w, res.StatusCode, errString(strings.TrimSpace(string(b))))
		return
	}
	c.hub.Log("ok", "docker removed image "+short(id), nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type volume struct {
	Name       string   `json:"name"`
	Driver     string   `json:"driver"`
	Mountpoint string   `json:"mountpoint"`
	Created    string   `json:"created"`
	UsedBy     []string `json:"usedBy"`
}

func (c *Client) listVolumes(w http.ResponseWriter, r *http.Request) {
	res, err := c.do(r.Context(), "GET", "/volumes")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	var raw struct {
		Volumes []struct {
			Name       string
			Driver     string
			Mountpoint string
			CreatedAt  string
		}
	}
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	volRefs, _ := c.containerRefs(r.Context())
	out := make([]volume, 0, len(raw.Volumes))
	for _, v := range raw.Volumes {
		out = append(out, volume{Name: v.Name, Driver: v.Driver, Mountpoint: v.Mountpoint, Created: v.CreatedAt, UsedBy: volRefs[v.Name]})
	}
	writeJSON(w, http.StatusOK, map[string]any{"volumes": out})
}

func (c *Client) removeVolume(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	c.hub.Log("info", "docker volume rm "+name, nil)
	res, err := c.do(r.Context(), "DELETE", "/volumes/"+name+"?force=1")
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		c.hub.Log("error", "docker volume rm failed", map[string]string{"error": strings.TrimSpace(string(b))})
		fail(w, res.StatusCode, errString(strings.TrimSpace(string(b))))
		return
	}
	c.hub.Log("ok", "docker removed volume "+name, nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// demux decodes Docker's multiplexed log stream (8-byte frame headers) into
// plain text; falls back to raw bytes if the stream is not framed.
func demux(r io.Reader) string {
	data, _ := io.ReadAll(r)
	var b strings.Builder
	i := 0
	for i+8 <= len(data) {
		st := data[i]
		if st > 2 { // not a frame header — treat the rest as raw
			b.Write(data[i:])
			return b.String()
		}
		n := int(binary.BigEndian.Uint32(data[i+4 : i+8]))
		i += 8
		if n < 0 || i+n > len(data) {
			b.Write(data[i:])
			break
		}
		b.Write(data[i : i+n])
		i += n
	}
	if b.Len() == 0 {
		return string(data)
	}
	return b.String()
}

func short(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

type errString string

func (e errString) Error() string { return string(e) }
