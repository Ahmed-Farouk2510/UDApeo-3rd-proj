import { Module } from '@nestjs/common';
import { CassandraService } from './cassandra.service';
import { ConfigModule } from '../config/config.module';
import { CassandraEmployeeRepository } from './repositories/cassandra-employee.repository';
import { CassandraProductRepository } from './repositories/cassandra-product.repository';
import { CassandraOrderRepository } from './repositories/cassandra-order.repository';

@Module({
  imports: [ConfigModule],
  providers: [
    CassandraService,
    CassandraEmployeeRepository,
    CassandraProductRepository,
    CassandraOrderRepository,
  ],
  exports: [
    CassandraService,
    CassandraEmployeeRepository,
    CassandraProductRepository,
    CassandraOrderRepository,
  ],
})
export class CassandraModule {}
