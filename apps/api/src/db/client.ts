import { connect } from '@tidbcloud/serverless';
import { drizzle } from 'drizzle-orm/tidb-serverless';
import * as schema from './schema';

// TiDB Cloud over HTTP (@tidbcloud/serverless): works in Workers without nodejs_compat (ADR-013). One client per
// call path; the driver holds no long-lived connection.

export function createDb(url: string) {
  return drizzle({ client: connect({ url }), schema });
}

export type Db = ReturnType<typeof createDb>;
