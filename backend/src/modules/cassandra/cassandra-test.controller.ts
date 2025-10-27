import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { CassandraEmployeeRepository } from './repositories/cassandra-employee.repository';
import { CassandraProductRepository } from './repositories/cassandra-product.repository';
import { CassandraOrderRepository } from './repositories/cassandra-order.repository';
import { Employee } from '../domain/employees/entities/employee.entity';
import { Product } from '../domain/orders/entities/product.entity';
import { Order } from '../domain/orders/entities/order.entity';

@Controller('cassandra-test')
export class CassandraTestController {
  constructor(
    private readonly employeeRepository: CassandraEmployeeRepository,
    private readonly productRepository: CassandraProductRepository,
    private readonly orderRepository: CassandraOrderRepository,
  ) {}

  // Employee endpoints
  @Post('employees')
  async createEmployee(@Body() employeeData: any) {
    const employee = new Employee(employeeData);
    return await this.employeeRepository.create(employee);
  }

  @Get('employees')
  async getAllEmployees() {
    return await this.employeeRepository.findAll(100);
  }

  @Get('employees/:id')
  async getEmployee(@Param('id') id: string) {
    return await this.employeeRepository.findById(id);
  }

  @Delete('employees/:id')
  async deleteEmployee(@Param('id') id: string) {
    return await this.employeeRepository.delete(id);
  }

  // Product endpoints
  @Post('products')
  async createProduct(@Body() productData: any) {
    const product = new Product();
    product.description = productData.description;
    return await this.productRepository.create(product);
  }

  @Get('products')
  async getAllProducts() {
    return await this.productRepository.findAll(100);
  }

  @Get('products/:id')
  async getProduct(@Param('id') id: string) {
    return await this.productRepository.findById(id);
  }

  // Order endpoints
  @Post('orders')
  async createOrder(@Body() orderData: any) {
    const order = new Order({ id: orderData.id });
    return await this.orderRepository.create(order);
  }

  @Get('orders')
  async getAllOrders() {
    return await this.orderRepository.findAll(100);
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    return await this.orderRepository.findById(id);
  }

  @Post('orders/:orderId/products/:productId')
  async addProductToOrder(
    @Param('orderId') orderId: string,
    @Param('productId') productId: string,
  ) {
    await this.orderRepository.addProductToOrder(orderId, productId);
    return { message: 'Product added to order successfully' };
  }
}
