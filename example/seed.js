'use strict'

// Seeds the example LocalStack with realistic-ish data so every panel of
// localstack-admin-lite has something to show:
//   S3   — two buckets with a handful of JSON/text objects
//   SQS  — a standard queue, a FIFO queue, and a source->DLQ pair (Redrive demo)
//   CFN  — one unexecuted change set (Execute demo)
//
// Safe to re-run: "already exists" style errors are ignored.

const fs = require('node:fs')
const path = require('node:path')

const { S3Client, CreateBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SendMessageCommand,
} = require('@aws-sdk/client-sqs')
const {
  CloudFormationClient,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
} = require('@aws-sdk/client-cloudformation')

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1'

const cfg = {
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
}

const s3 = new S3Client({ ...cfg, forcePathStyle: true })
const sqs = new SQSClient(cfg)
const cf = new CloudFormationClient(cfg)

function tolerate(re) {
  return (err) => {
    if (re.test(err.name || '') || re.test(String(err.message || ''))) return null
    throw err
  }
}

async function seedS3() {
  const buckets = {
    'app-uploads': {
      'users/1.json': JSON.stringify({ id: 1, name: 'Ada Lovelace', role: 'admin' }, null, 2),
      'users/2.json': JSON.stringify({ id: 2, name: 'Alan Turing', role: 'user' }, null, 2),
      'config/settings.json': JSON.stringify({ theme: 'dark', retries: 3, featureFlags: ['beta'] }, null, 2),
      'logs/2026-06-26.txt': '12:00:01 INFO  boot ok\n12:00:02 WARN  cache cold\n12:00:05 INFO  ready\n',
      'readme.txt': 'Demo bucket seeded by localstack-admin-lite/example/seed.js\n',
    },
    'app-backups': {
      'db/snapshot-1.json': JSON.stringify({ rows: 1024, takenAt: '2026-06-25T03:00:00Z' }, null, 2),
      'db/snapshot-2.json': JSON.stringify({ rows: 1138, takenAt: '2026-06-26T03:00:00Z' }, null, 2),
    },
  }

  for (const [bucket, objects] of Object.entries(buckets)) {
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(tolerate(/BucketAlreadyOwnedByYou|BucketAlreadyExists/))
    for (const [key, body] of Object.entries(objects)) {
      const contentType = key.endsWith('.json') ? 'application/json' : 'text/plain'
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
    }
    console.log(`  s3   ${bucket} (${Object.keys(objects).length} objects)`)
  }
}

async function createQueue(name, attributes) {
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }))
  return QueueUrl
}

async function queueArn(url) {
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }))
  return Attributes.QueueArn
}

async function seedSqs() {
  // standard queue
  const ordersUrl = await createQueue('orders')
  for (const order of [
    { orderId: 'ORD-1001', total: 49.9, items: 2 },
    { orderId: 'ORD-1002', total: 12.0, items: 1 },
    { orderId: 'ORD-1003', total: 320.5, items: 7 },
  ]) {
    await sqs.send(new SendMessageCommand({ QueueUrl: ordersUrl, MessageBody: JSON.stringify(order) }))
  }
  console.log('  sqs  orders (standard, 3 msgs)')

  // FIFO queue with content-based dedup
  const paymentsUrl = await createQueue('payments.fifo', {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true',
  })
  for (const pay of [
    { paymentId: 'PAY-1', orderId: 'ORD-1001', amount: 49.9, group: 'acct-A' },
    { paymentId: 'PAY-2', orderId: 'ORD-1003', amount: 320.5, group: 'acct-B' },
  ]) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: paymentsUrl,
      MessageBody: JSON.stringify(pay),
      MessageGroupId: pay.group,
    }))
  }
  console.log('  sqs  payments.fifo (fifo, 2 msgs)')

  // DLQ + source queue wired via RedrivePolicy.
  // The viewer detects a DLQ by the substring "-dlq-" in the name and only
  // then exposes the Redrive button, so name it accordingly.
  const dlqUrl = await createQueue('notifications-dlq-main')
  const dlqArn = await queueArn(dlqUrl)

  const sourceUrl = await createQueue('notifications', {
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
  })
  // ensure the policy sticks even if the source queue already existed
  await sqs.send(new SetQueueAttributesCommand({
    QueueUrl: sourceUrl,
    Attributes: { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }) },
  }))

  await sqs.send(new SendMessageCommand({ QueueUrl: sourceUrl, MessageBody: JSON.stringify({ notify: 'welcome', userId: 1 }) }))

  // seed the DLQ directly to simulate poison messages waiting to be redriven
  for (const failed of [
    { notify: 'receipt', userId: 2, error: 'SMTP timeout' },
    { notify: 'receipt', userId: 5, error: 'invalid address' },
    { notify: 'alert', userId: 9, error: 'rate limited' },
  ]) {
    await sqs.send(new SendMessageCommand({ QueueUrl: dlqUrl, MessageBody: JSON.stringify(failed) }))
  }
  console.log('  sqs  notifications (standard, 1 msg) -> notifications-dlq-main (dlq, 3 msgs)')
}

async function seedChangeset() {
  const templateBody = fs.readFileSync(path.join(__dirname, 'cfn-template.yaml'), 'utf8')
  const stackName = 'demo-app-stack'
  const changeSetName = 'demo-app-initial'

  // ChangeSetType CREATE leaves the stack in REVIEW_IN_PROGRESS and the change
  // set AVAILABLE — exactly what the viewer lists as "pending execution".
  await cf.send(new CreateChangeSetCommand({
    StackName: stackName,
    ChangeSetName: changeSetName,
    ChangeSetType: 'CREATE',
    TemplateBody: templateBody,
    Capabilities: ['CAPABILITY_NAMED_IAM'],
  })).catch(tolerate(/already exists|AlreadyExists/))

  // wait until it finishes creating so the viewer shows it as executable
  for (let i = 0; i < 30; i++) {
    try {
      const { Status, ExecutionStatus } = await cf.send(
        new DescribeChangeSetCommand({ StackName: stackName, ChangeSetName: changeSetName }),
      )
      if (Status === 'CREATE_COMPLETE' && ExecutionStatus === 'AVAILABLE') break
      if (Status === 'FAILED') break
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.log(`  cfn  ${stackName} / ${changeSetName} (change set, pending execution)`)
}

async function main() {
  console.log(`seeding LocalStack at ${ENDPOINT}`)
  await seedS3()
  await seedSqs()
  await seedChangeset()
  console.log('done.')
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
