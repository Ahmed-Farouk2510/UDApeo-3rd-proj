import { Injectable } from '@nestjs/common';
import { CassandraService } from '../cassandra.service';
import { Product } from '../../domain/orders/entities/product.entity';
import { types } from 'cassandra-driver';

@Injectable()
export class CassandraProductRepository {
  constructor(private readonly cassandraService: CassandraService) {}

  async create(product: Product): Promise<Product> {
    const id = types.Uuid.random();
    const query = `
      INSERT INTO products (id, description, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `;

    const params = [
      id,
      product.description,
      new Date(),
      new Date(),
    ];

    await this.cassandraService.execute(query, params);
    
    product.id = id.toString();
    return product;
  }

  async findById(id: string): Promise<Product | null> {
    const query = 'SELECT * FROM products WHERE id = ?';
    const result = await this.cassandraService.execute(query, [types.Uuid.fromString(id)]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToProduct(result.rows[0]);
  }

  async findAll(limit: number = 100): Promise<Product[]> {
    const query = 'SELECT * FROM products LIMIT ?';
    const result = await this.cassandraService.execute(query, [limit]);
    
    return result.rows.map(row => this.mapRowToProduct(row));
  }

  async update(id: string, description: string): Promise<Product | null> {
    const query = 'UPDATE products SET description = ?, updated_at = ? WHERE id = ?';
    const params = [description, new Date(), types.Uuid.fromString(id)];
    
    await this.cassandraService.execute(query, params);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM products WHERE id = ?';
    await this.cassandraService.execute(query, [types.Uuid.fromString(id)]);
    return true;
  }

  private mapRowToProduct(row: any): Product {
    const product = new Product();
    product.id = row.id.toString();
    product.description = row.description;
    return product;
  }
}
