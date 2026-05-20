import {
  loadWorkflowManifestBundle,
  validateWorkflowManifestBundle,
  workflowManifestFingerprint,
} from './workflow-config/manifest-loader.js'

const bundle = await loadWorkflowManifestBundle()
const result = validateWorkflowManifestBundle(bundle)

console.log(
  JSON.stringify(
    {
      configVersion: result.bundle.configSet.configVersion,
      fingerprint: workflowManifestFingerprint(result.bundle),
      summary: result.summary,
    },
    null,
    2,
  ),
)
