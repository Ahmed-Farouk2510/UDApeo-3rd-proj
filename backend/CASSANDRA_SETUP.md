# Cassandra Database Setup

This project now includes Apache Cassandra as a database option alongside PostgreSQL.

## Getting Started

### 1. Start Cassandra with Docker Compose

From the project root, run:

```bash
cd util
docker-compose up -d cassandra
```

This will start a Cassandra container on port `9042`.

### 2. Verify Cassandra is Running

Check the health of the Cassandra container:

```bash
docker ps
```

You should see the cassandra container running and healthy.

### 3. Configuration

Cassandra configuration is managed through environment variables. The default values are set in `backend/development.env`:

```
CASSANDRA_HOST=localhost
CASSANDRA_PORT=9042
CASSANDRA_KEYSPACE=glee
CASSANDRA_USERNAME=cassandra
CASSANDRA_PASSWORD=cassandra
CASSANDRA_DATACENTER=datacenter1
```

### 4. Schema Initialization

The Cassandra schema is automatically initialized when the application starts. The `CassandraService` creates:

- **Keyspace**: `glee` (configurable)
- **Tables**:
  - `employees` - Employee records
  - `products` - Product catalog
  - `orders` - Order records
  - `order_products` - Many-to-many relationship between orders and products

### 5. Using Cassandra in Your Code

#### Import the CassandraModule

```typescript
import { CassandraModule } from '../cassandra/cassandra.module';

@Module({
  imports: [CassandraModule],
  // ...
})
export class YourModule {}
```

#### Use the Repositories

```typescript
import { Injectable } from '@nestjs/common';
import { CassandraEmployeeRepository } from '../cassandra';

@Injectable()
export class YourService {
  constructor(
    private readonly employeeRepository: CassandraEmployeeRepository,
  ) {}

  async createEmployee(data: any) {
    return await this.employeeRepository.create(data);
  }

  async getEmployee(id: string) {
    return await this.employeeRepository.findById(id);
  }
}
```

#### Direct Database Access

```typescript
import { Injectable } from '@nestjs/common';
import { CassandraService } from '../cassandra';

@Injectable()
export class YourService {
  constructor(private readonly cassandraService: CassandraService) {}

  async executeQuery() {
    const query = 'SELECT * FROM employees LIMIT 10';
    const result = await this.cassandraService.execute(query);
    return result.rows;
  }
}
```

## Available Repositories

### CassandraEmployeeRepository

Methods:
- `create(employee: Employee): Promise<Employee>`
- `findById(id: string): Promise<Employee | null>`
- `findAll(limit?: number): Promise<Employee[]>`
- `findByEmail(email: string): Promise<Employee | null>`
- `findByCountry(country: string, limit?: number): Promise<Employee[]>`
- `update(id: string, employee: Partial<Employee>): Promise<Employee | null>`
- `delete(id: string): Promise<boolean>`

### CassandraProductRepository

Methods:
- `create(product: Product): Promise<Product>`
- `findById(id: string): Promise<Product | null>`
- `findAll(limit?: number): Promise<Product[]>`
- `update(id: string, description: string): Promise<Product | null>`
- `delete(id: string): Promise<boolean>`

### CassandraOrderRepository

Methods:
- `create(order: Order): Promise<Order>`
- `findById(id: string): Promise<Order | null>`
- `findAll(limit?: number): Promise<Order[]>`
- `addProductToOrder(orderId: string, productId: string): Promise<void>`
- `getOrderProducts(orderId: string): Promise<Product[]>`
- `delete(id: string): Promise<boolean>`

## Connecting to Cassandra CLI

To connect to the Cassandra container using `cqlsh`:

```bash
docker exec -it cassandra cqlsh
```

Then you can run CQL commands:

```cql
USE glee;
DESCRIBE TABLES;
SELECT * FROM employees LIMIT 10;
```

## Important Notes

### Data Modeling Differences

Cassandra is a NoSQL database with different characteristics than PostgreSQL:

1. **No Joins**: Cassandra doesn't support joins. Data is denormalized.
2. **Query-First Design**: Tables are designed around queries, not relationships.
3. **Primary Keys**: The partition key determines data distribution across nodes.
4. **ALLOW FILTERING**: Used in queries (like `findByEmail`), but should be avoided in production for performance reasons. Consider creating materialized views or secondary indexes instead.

### Performance Considerations

1. **Secondary Indexes**: The setup includes indexes on `company_email` and `country`. For production, evaluate if these are the right indexes for your queries.

2. **Materialized Views**: For complex queries, consider using materialized views instead of `ALLOW FILTERING`.

3. **Batch Operations**: For bulk inserts, use batch statements for better performance.

### Production Recommendations

Before deploying to production:

1. **Replication Strategy**: Change from `SimpleStrategy` to `NetworkTopologyStrategy` for multi-datacenter deployments.
2. **Consistency Levels**: Configure appropriate consistency levels for your use case.
3. **Monitoring**: Set up monitoring for Cassandra metrics.
4. **Backup Strategy**: Implement regular snapshot backups.
5. **Optimize Indexes**: Review and optimize secondary indexes based on actual query patterns.

## Troubleshooting

### Cassandra Container Won't Start

Check the logs:
```bash
docker logs cassandra
```

### Connection Issues

Ensure the container is healthy:
```bash
docker ps
```

Wait for the healthcheck to pass (may take 30-60 seconds after starting).

### Schema Issues

To reset the schema, connect to cqlsh and run:
```cql
DROP KEYSPACE glee;
```

Then restart the application to recreate the schema.
