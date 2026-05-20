import type { FastifyInstance } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string
  }
}

export function registerRawJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const rawBody = typeof body === 'string' ? body : body.toString('utf8')

      request.rawBody = rawBody

      try {
        done(null, JSON.parse(rawBody))
      } catch (error) {
        const payloadError = error as Error & {
          code?: string
          statusCode?: number
        }
        payloadError.code = 'invalid_webhook_payload'
        payloadError.statusCode = 400
        done(payloadError)
      }
    },
  )
}
