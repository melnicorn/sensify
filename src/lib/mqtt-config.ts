// Broker connection settings, read from the environment in one place so the
// long-running subscriber (src/ingest) and the web process's one-shot topic
// browser (browseMqttAction) always agree on the env var names.
//
// Defaults target an anonymous broker on localhost — the zero-config setup for
// running from source (`brew services start mosquitto`). In Docker these are
// set to the mosquitto service + credentials by the compose files.
export interface MqttConnectionConfig {
  url: string
  username?: string
  password?: string
}

export function mqttConfigFromEnv(): MqttConnectionConfig {
  return {
    url: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  }
}
