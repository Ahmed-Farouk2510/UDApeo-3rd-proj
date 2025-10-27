import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client } from 'cassandra-driver';
import { ConfigService } from '../config/config.service';

@Injectable()
export class CassandraService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private isConnected: boolean = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    try {
      this.client = new Client({
        contactPoints: [this.configService.CASSANDRA_HOST],
        localDataCenter: this.configService.CASSANDRA_DATACENTER,
        keyspace: this.configService.CASSANDRA_KEYSPACE,
        credentials: {
          username: this.configService.CASSANDRA_USERNAME,
          password: this.configService.CASSANDRA_PASSWORD,
        },
      });

      await this.client.connect();
      this.isConnected = true;
      console.log('Connected to Cassandra cluster');
      
      // Initialize schema
      await this.initializeSchema();
    } catch (error) {
      console.error('Failed to connect to Cassandra:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.shutdown();
      this.isConnected = false;
      console.log('Disconnected from Cassandra cluster');
    }
  }

  getClient(): Client {
    if (!this.isConnected) {
      throw new Error('Cassandra client is not connected');
    }
    return this.client;
  }

  async execute(query: string, params?: any[], options?: any): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Cassandra client is not connected');
    }
    return this.client.execute(query, params, options);
  }

  private async initializeSchema(): Promise<void> {
    const keyspace = this.configService.CASSANDRA_KEYSPACE;
    
    // Create keyspace if it doesn't exist
    const createKeyspaceQuery = `
      CREATE KEYSPACE IF NOT EXISTS ${keyspace}
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}
    `;
    
    try {
      await this.client.execute(createKeyspaceQuery);
      console.log(`Keyspace ${keyspace} created or already exists`);

      // Use the keyspace
      await this.client.execute(`USE ${keyspace}`);

      // Create employees table
      const createEmployeesTable = `
        CREATE TABLE IF NOT EXISTS employees (
          id UUID PRIMARY KEY,
          first_name TEXT,
          middle_name TEXT,
          last_name TEXT,
          second_last_name TEXT,
          display_name TEXT,
          company_email TEXT,
          personal_email TEXT,
          birthdate TIMESTAMP,
          start_date TIMESTAMP,
          address TEXT,
          phone_number TEXT,
          bank_name TEXT,
          account_number TEXT,
          gender TEXT,
          tags TEXT,
          country TEXT,
          region TEXT,
          city TEXT,
          effective_date TIMESTAMP,
          salary DECIMAL,
          salary_type TEXT,
          is_active BOOLEAN,
          working_hours_per_week INT,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `;
      await this.client.execute(createEmployeesTable);
      console.log('Employees table created or already exists');

      // Create products table
      const createProductsTable = `
        CREATE TABLE IF NOT EXISTS products (
          id UUID PRIMARY KEY,
          description TEXT,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `;
      await this.client.execute(createProductsTable);
      console.log('Products table created or already exists');

      // Create orders table
      const createOrdersTable = `
        CREATE TABLE IF NOT EXISTS orders (
          id UUID PRIMARY KEY,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `;
      await this.client.execute(createOrdersTable);
      console.log('Orders table created or already exists');

      // Create order_products table (many-to-many relationship)
      const createOrderProductsTable = `
        CREATE TABLE IF NOT EXISTS order_products (
          order_id UUID,
          product_id UUID,
          created_at TIMESTAMP,
          PRIMARY KEY (order_id, product_id)
        )
      `;
      await this.client.execute(createOrderProductsTable);
      console.log('Order_products table created or already exists');

      // Create secondary indexes for common queries
      const createEmployeeEmailIndex = `
        CREATE INDEX IF NOT EXISTS ON employees (company_email)
      `;
      await this.client.execute(createEmployeeEmailIndex);
      
      const createEmployeeCountryIndex = `
        CREATE INDEX IF NOT EXISTS ON employees (country)
      `;
      await this.client.execute(createEmployeeCountryIndex);

    } catch (error) {
      console.error('Error initializing schema:', error);
      throw error;
    }
  }
}
