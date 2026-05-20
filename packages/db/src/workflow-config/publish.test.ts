import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeWithSerializationRetry,
  isSerializationFailureError,
} from './publish.js'

test('isSerializationFailureError matches direct and nested serialization failures', () => {
  assert.equal(
    isSerializationFailureError({ code: '40001' }),
    true,
  )
  assert.equal(
    isSerializationFailureError({ cause: { code: '40001' } }),
    true,
  )
  assert.equal(
    isSerializationFailureError({ code: '23505' }),
    false,
  )
  assert.equal(isSerializationFailureError(new Error('plain failure')), false)
})

test('executeWithSerializationRetry retries serialization failures and succeeds', async () => {
  let attempts = 0
  const delays: number[] = []

  const result = await executeWithSerializationRetry(
    async () => {
      attempts += 1

      if (attempts < 3) {
        throw Object.assign(new Error('serialization failure'), {
          code: '40001',
        })
      }

      return 'published'
    },
    {
      maxRetries: 3,
      sleep: async (ms: number) => {
        delays.push(ms)
      },
    },
  )

  assert.equal(result, 'published')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [25, 50])
})

test('executeWithSerializationRetry stops after the retry budget is exhausted', async () => {
  let attempts = 0

  await assert.rejects(
    () =>
      executeWithSerializationRetry(
        async () => {
          attempts += 1
          throw Object.assign(new Error('still contended'), {
            code: '40001',
          })
        },
        {
          maxRetries: 2,
          sleep: async () => {},
        },
      ),
    /still contended/,
  )

  assert.equal(attempts, 3)
})

test('executeWithSerializationRetry does not retry non-serialization failures', async () => {
  let attempts = 0

  await assert.rejects(
    () =>
      executeWithSerializationRetry(
        async () => {
          attempts += 1
          throw Object.assign(new Error('integrity error'), {
            code: '23505',
          })
        },
        {
          maxRetries: 3,
          sleep: async () => {},
        },
      ),
    /integrity error/,
  )

  assert.equal(attempts, 1)
})
