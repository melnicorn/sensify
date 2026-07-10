import { NextResponse } from 'next/server'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ReadingInputSchema } from '@/lib/schemas'

const schema = {
  openapi: '3.0.0',
  info: {
    title: 'Sensify API',
    version: '1',
    description: 'Inject sensor readings. All endpoints require a Bearer token.',
  },
  paths: {
    '/api/v1/readings': {
      post: {
        summary: 'Submit a sensor reading',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: zodToJsonSchema(ReadingInputSchema, { name: 'ReadingInput', $refStrategy: 'none' }),
              examples: {
                temperature_and_humidity: {
                  summary: 'Climate sensor (°C)',
                  value: {
                    sensorId: 'dht22-living-room',
                    sensorName: 'Living Room',
                    data: {
                      temperature: { value: 22.5, unit: 'C' },
                      humidity: { value: 48.2 },
                    },
                  },
                },
                temperature_only_fahrenheit: {
                  summary: 'Temperature-only sensor (°F)',
                  value: {
                    sensorId: 'temp-outside',
                    sensorName: 'Outdoor Thermometer',
                    data: {
                      temperature: { value: 72.3, unit: 'F' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Reading accepted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid Bearer token' },
          '422': { description: 'Validation error' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Set SENSIFY_API_TOKEN on the server and pass it as Authorization: Bearer <token>',
      },
    },
  },
}

export function GET() {
  return NextResponse.json(schema, {
    headers: { 'Content-Type': 'application/json' },
  })
}
