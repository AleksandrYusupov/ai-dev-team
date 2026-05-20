import type { FastifyPluginAsync } from 'fastify'

import type { KnowledgeReadRepository } from '../knowledge.js'

interface KnowledgeRoutesOptions {
  knowledgeReadRepository: KnowledgeReadRepository
}

export const knowledgeRoutes: FastifyPluginAsync<KnowledgeRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/repositories/:repoSlug', async (request, reply) => {
    const { repoSlug } = request.params as { repoSlug: string }
    const repository = await options.knowledgeReadRepository.getRepository(repoSlug)

    if (!repository) {
      return reply.status(404).send({ error: 'repository_registry_not_found' })
    }

    return repository
  })

  app.get('/projects/:projectId/repository-mapping', async (request) => {
    const { projectId } = request.params as { projectId: string }

    return options.knowledgeReadRepository.getProjectRepositoryMapping(projectId)
  })

  app.get('/issues/:issueId/context-pack', async (request) => {
    const { issueId } = request.params as { issueId: string }

    return options.knowledgeReadRepository.getContextPack(issueId)
  })
}
