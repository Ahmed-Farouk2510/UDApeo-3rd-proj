# Cassandra Database Integration

This document describes the Cassandra database integration for the Glee application.

## Overview

The application now supports Apache Cassandra as a NoSQL database option alongside the existing PostgreSQL database. This provides:

- **Scalability**: Horizontal scaling for large datasets
- **High Availability**: Distributed architecture with no single point of failure
- **Performance**: Optimized for write-heavy workloads
- **Flexibility**: Schema-flexible NoSQL data model

## What's Been Added

### 1. Docker Compose Configuration

A Cassandra service has been added to `util/docker-compose.yml`:

- **Image**: Cassandra 4.1
- **Port**: 9042 (default CQL port)
- **Volume**: Persistent data storage
- **Health Check**: Automatic health monitoring

### 2. Backend Infrastructure

#### Cassandra Module (`backend/src/modules/cassandra/`)

- **CassandraService**: Core service managing database connections
- **CassandraModule**: NestJS module for dependency injection
- **Repositories**: Type-safe repository pattern for each entity
  - `CassandraEmployeeRepository`
  - `CassandraProductRepository`
  - `CassandraOrderRepository`

#### Configuration Updates

- **ConfigService**: Extended with Cassandra configuration properties
- **Environment Variables**: New Cassandra-specific settings in `development.env`
- **Type Safety**: Full TypeScript support with type definitions

### 3. Database Schema

Automatically created tables:

```
employees
├── id (UUID, PRIMARY KEY)
├── first_name, last_name, middle_name, etc.
├── company_email (INDEXED)
├── country (INDEXED)
└── ... (25+ fields)

products
├── id (UUID, PRIMARY KEY)
└── description

orders
├── id (UUID, PRIMARY KEY)
└── timestamps

order_products (junction table)
├── order_id (UUID, PARTITION KEY)
├── product_id (UUID, CLUSTERING KEY)
└── created_at
```

### 4. Test Controller

A test controller (`CassandraTestController`) provides REST endpoints at `/cassandra-test/*` for:
- CRUD operations on employees, products, and orders
- Testing the Cassandra integration
- Validating data persistence

## Quick Start

### 1. Start Cassandra

```bash
cd util
docker-compose up -d cassandra
```

Wait for the container to be healthy (~30-60 seconds):

```bash
docker ps
```

### 2. Start the Backend

```bash
cd ../backend
npm install
npm run start:dev
```

The application will automatically:
- Connect to Cassandra
- Create the keyspace `glee`
- Initialize all tables
- Create indexes

### 3. Test the Integration

Use the provided test script:

```bash
cd backend
./cassandra-test-examples.sh
```

Or manually test with curl:

```bash
# Create an employee
curl -X POST http://localhost:3030/cassandra-test/employees \
  -H 'Content-Type: application/json' \
  -d '{
    "firstName": "Jane",
    "lastName": "Smith",
    "companyEmail": "jane.smith@company.com",
    "country": "USA",
    "region": "New York",
    "city": "New York City",
    "startDate": "2024-01-15",
    "effectiveDate": "2024-01-15",
    "salary": 120000,
    "salaryType": "yearly"
  }'

# Get all employees
curl http://localhost:3030/cassandra-test/employees
```

### 4. Verify in CQL Shell

```bash
docker exec -it cassandra cqlsh
```

```cql
USE glee;
DESCRIBE TABLES;
SELECT * FROM employees;
```

## Configuration

### Environment Variables

Add to `.env` or environment:

```bash
CASSANDRA_HOST=localhost              # Cassandra host
CASSANDRA_PORT=9042                   # CQL native port
CASSANDRA_KEYSPACE=glee               # Keyspace name
CASSANDRA_USERNAME=cassandra          # Auth username
CASSANDRA_PASSWORD=cassandra          # Auth password
CASSANDRA_DATACENTER=datacenter1      # Local datacenter
```

### Customizing the Configuration

Edit `backend/development.env` to change default values for local development.

## Using Cassandra in Your Code

### Example: Employee Service

```typescript
import { Injectable } from '@nestjs/common';
import { CassandraEmployeeRepository } from '../cassandra';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly cassandraRepo: CassandraEmployeeRepository,
  ) {}

  async createEmployee(data: any) {
    const employee = new Employee(data);
    return await this.cassandraRepo.create(employee);
  }

  async getEmployeesByCountry(country: string) {
    return await this.cassandraRepo.findByCountry(country, 50);
  }

  async updateEmployee(id: string, updates: Partial<Employee>) {
    return await this.cassandraRepo.update(id, updates);
  }
}
```

### Example: Direct CQL Queries

```typescript
import { Injectable } from '@nestjs/common';
import { CassandraService } from '../cassandra';

@Injectable()
export class CustomQueryService {
  constructor(private readonly cassandra: CassandraService) {}

  async customQuery() {
    const query = `
      SELECT country, COUNT(*) as count 
      FROM employees 
      WHERE country = ? 
      ALLOW FILTERING
    `;
    
    const result = await this.cassandra.execute(query, ['USA']);
    return result.rows;
  }
}
```

## Architecture Decisions

### Dual Database Support

The application maintains **both** PostgreSQL and Cassandra:

- **PostgreSQL**: ACID transactions, complex queries, relational data
- **Cassandra**: High-volume writes, distributed data, time-series data

This allows you to:
1. Choose the right database for each use case
2. Gradually migrate from PostgreSQL to Cassandra
3. Use Cassandra for specific high-scale features while keeping existing code

### Repository Pattern

Repositories provide:
- **Abstraction**: Hide database implementation details
- **Type Safety**: Full TypeScript support
- **Testability**: Easy to mock for unit tests
- **Consistency**: Uniform API across different data stores

### Schema Management

Unlike PostgreSQL migrations, Cassandra schema is:
- **Auto-initialized**: Created on application startup
- **Idempotent**: Safe to run multiple times
- **Version-controlled**: Schema defined in code

## Performance Considerations

### Query Patterns

Cassandra is optimized for:
- ✅ Primary key lookups
- ✅ Range queries on clustering columns
- ✅ High-volume writes
- ⚠️ Secondary index queries (use sparingly)
- ❌ Complex joins (not supported)
- ❌ Full table scans

### Best Practices

1. **Design around queries**: Create tables based on access patterns
2. **Avoid ALLOW FILTERING**: Denormalize data instead
3. **Use batch operations**: For related writes
4. **Monitor performance**: Track query latency and throughput

### Scaling

To scale Cassandra:

```bash
# Add more nodes to docker-compose.yml
cassandra-2:
  image: "cassandra:4.1"
  environment:
    - CASSANDRA_SEEDS=cassandra
  depends_on:
    - cassandra
```

## Monitoring and Debugging

### Health Check

```bash
curl http://localhost:3030/status
```

### Cassandra Logs

```bash
docker logs cassandra
```

### CQL Shell Access

```bash
docker exec -it cassandra cqlsh
```

### Useful CQL Commands

```cql
-- Show all keyspaces
DESCRIBE KEYSPACES;

-- Use the glee keyspace
USE glee;

-- Show all tables
DESCRIBE TABLES;

-- Show table schema
DESCRIBE TABLE employees;

-- Query data
SELECT * FROM employees LIMIT 10;

-- Count records
SELECT COUNT(*) FROM employees;
```

## Troubleshooting

### Container Won't Start

```bash
docker logs cassandra
docker-compose restart cassandra
```

### Connection Refused

Wait for Cassandra to fully start (~60 seconds). Check health:

```bash
docker exec cassandra nodetool status
```

### Schema Issues

Reset the keyspace:

```cql
DROP KEYSPACE glee;
```

Then restart the application to recreate.

### Performance Issues

1. Check query patterns (avoid ALLOW FILTERING)
2. Review secondary indexes
3. Consider materialized views
4. Monitor with `nodetool`:

```bash
docker exec cassandra nodetool tablestats glee
```

## Migration Strategy

To migrate from PostgreSQL to Cassandra:

### 1. Parallel Write

Write to both databases during transition:

```typescript
async createEmployee(data: any) {
  // Write to both
  const pgEmployee = await this.pgRepo.save(data);
  const cassEmployee = await this.cassandraRepo.create(data);
  
  return pgEmployee; // Return primary source
}
```

### 2. Gradual Read Migration

Start reading from Cassandra for new features:

```typescript
async getEmployee(id: string) {
  // Try Cassandra first
  let employee = await this.cassandraRepo.findById(id);
  
  // Fallback to PostgreSQL
  if (!employee) {
    employee = await this.pgRepo.findById(id);
  }
  
  return employee;
}
```

### 3. Data Backfill

Create a script to copy existing data:

```typescript
async backfillData() {
  const employees = await this.pgRepo.findAll();
  
  for (const emp of employees) {
    await this.cassandraRepo.create(emp);
  }
}
```

### 4. Switch Primary

Once validated, make Cassandra the primary database:

```typescript
async createEmployee(data: any) {
  // Cassandra is now primary
  const employee = await this.cassandraRepo.create(data);
  
  // Optional: async write to PG for backup
  this.pgRepo.save(data).catch(err => 
    console.error('PG backup failed:', err)
  );
  
  return employee;
}
```

## Production Checklist

Before deploying to production:

- [ ] Change replication strategy to NetworkTopologyStrategy
- [ ] Configure appropriate replication factor (3+ for production)
- [ ] Set up authentication (don't use default credentials)
- [ ] Enable SSL/TLS for connections
- [ ] Configure backup strategy (snapshots)
- [ ] Set up monitoring (Prometheus, Grafana)
- [ ] Tune JVM heap sizes based on load
- [ ] Review and optimize table schemas
- [ ] Replace ALLOW FILTERING with proper indexes
- [ ] Load test with production-like data
- [ ] Document runbook for common operations

## Additional Resources

- [Apache Cassandra Documentation](https://cassandra.apache.org/doc/)
- [DataStax Node.js Driver](https://docs.datastax.com/en/developer/nodejs-driver/)
- [CQL Reference](https://cassandra.apache.org/doc/latest/cql/)
- [Backend Setup Guide](backend/CASSANDRA_SETUP.md)

## Support

For issues or questions:

1. Check the logs: `docker logs cassandra`
2. Review [CASSANDRA_SETUP.md](backend/CASSANDRA_SETUP.md)
3. Test with the provided test controller
4. Verify CQL access with `cqlsh`
