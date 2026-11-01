import 'reflect-metadata';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from '../config';
import { ENTITIES } from './entities';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: config.databaseUrl,
  entities: ENTITIES,
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: ['error'],
};

/** Used by the TypeORM CLI (migrations). The app connects through the same options. */
export default new DataSource(dataSourceOptions);
