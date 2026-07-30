import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';

// Credenciais vêm SEMPRE do ambiente — nunca hardcoded.
// Rode com: node --env-file=.env.local --experimental-strip-types scripts/test-graph.ts
const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_USER_EMAIL } = process.env;

async function main() {
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    throw new Error(
      'Faltam MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET no ambiente (.env.local)'
    );
  }

  const credential = new ClientSecretCredential(
    MS_TENANT_ID.trim(),
    MS_CLIENT_ID.trim(),
    MS_CLIENT_SECRET.trim()
  );
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
  });
  const client = Client.initWithMiddleware({ authProvider });

  const resp = await client.api(`/users/${MS_USER_EMAIL ?? 'xps.ai@exsa.srv.br'}/messages`)
    .select('id,subject,from,receivedDateTime,hasAttachments')
    .orderby('receivedDateTime desc')
    .top(10)
    .get();

  console.log('Emails encontrados:', resp.value?.length ?? 0);
  for (const m of resp.value || []) {
    console.log(`  ${m.receivedDateTime?.slice(0,10)} | ${m.subject} | anexos: ${m.hasAttachments}`);
  }
}

main().catch(console.error);
