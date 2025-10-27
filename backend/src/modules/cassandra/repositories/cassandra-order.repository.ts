import { Injectable } from '@nestjs/common';
import { CassandraService } from '../cassandra.service';
import { Order } from '../../domain/orders/entities/order.entity';
import { Product } from '../../domain/orders/entities/product.entity';
import { types } from 'cassandra-driver';

@Injectable()
export class CassandraOrderRepository {
  constructor(private readonly cassandraService: CassandraService) {}

  async create(order: Order): Promise<Order> {
    const id = order.id ? types.Uuid.fromString(order.id) : types.Uuid.random();
    const query = `
      INSERT INTO orders (id, created_at, updated_at)
      VALUES (?, ?, ?)
    `;

    const params = [
      id,
      new Date(),
      new Date(),
    ];

    await this.cassandraService.execute(query, params);
    
    order.id = id.toString();
    
    // Insert products if any
    if (order.products && order.products.length > 0) {
      for (const product of order.products) {
        await this.addProductToOrder(order.id, product.id);
      }
    }
    
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = ?';
    const result = await this.cassandraService.execute(query, [types.Uuid.fromString(id)]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const order = this.mapRowToOrder(result.rows[0]);
    
    // Load associated products
    order.products = await this.getOrderProducts(id);
    
    return order;
  }

  async findAll(limit: number = 100): Promise<Order[]> {
    const query = 'SELECT * FROM orders LIMIT ?';
    const result = await this.cassandraService.execute(query, [limit]);
    
    const orders = result.rows.map(row => this.mapRowToOrder(row));
    
    // Load products for each order
    for (const order of orders) {
      order.products = await this.getOrderProducts(order.id);
    }
    
    return orders;
  }

  async addProductToOrder(orderId: string, productId: string): Promise<void> {
    const query = `
      INSERT INTO order_products (order_id, product_id, created_at)
      VALUES (?, ?, ?)
    `;
    
    const params = [
      types.Uuid.fromString(orderId),
      types.Uuid.fromString(productId),
      new Date(),
    ];
    
    await this.cassandraService.execute(query, params);
  }

  async getOrderProducts(orderId: string): Promise<Product[]> {
    const query = 'SELECT product_id FROM order_products WHERE order_id = ?';
    const result = await this.cassandraService.execute(query, [types.Uuid.fromString(orderId)]);
    
    const products: Product[] = [];
    
    for (const row of result.rows) {
      const productQuery = 'SELECT * FROM products WHERE id = ?';
      const productResult = await this.cassandraService.execute(productQuery, [row.product_id]);
      
      if (productResult.rows.length > 0) {
        const product = new Product();
        product.id = productResult.rows[0].id.toString();
        product.description = productResult.rows[0].description;
        products.push(product);
      }
    }
    
    return products;
  }

  async delete(id: string): Promise<boolean> {
    // Delete order products first
    const deleteProductsQuery = 'DELETE FROM order_products WHERE order_id = ?';
    await this.cassandraService.execute(deleteProductsQuery, [types.Uuid.fromString(id)]);
    
    // Delete order
    const deleteOrderQuery = 'DELETE FROM orders WHERE id = ?';
    await this.cassandraService.execute(deleteOrderQuery, [types.Uuid.fromString(id)]);
    
    return true;
  }

  private mapRowToOrder(row: any): Order {
    const order = new Order();
    order.id = row.id.toString();
    order.products = [];
    return order;
  }
}
