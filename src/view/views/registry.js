// The view registry: maps view name → view object. main.js hands this to the
// render engine via registerViews(). Add a new view by writing views/<name>.js
// and registering it here.
import { sqsView } from './sqs.js'
import { s3View } from './s3.js'
import { dockerView } from './docker.js'
import { providerView } from './providers.js'

export const VIEWS = {
  sqs: sqsView,
  s3: s3View,
  docker: dockerView(),
  kafka: providerView('kafka'),
  pgmq: providerView('pgmq'),
}
