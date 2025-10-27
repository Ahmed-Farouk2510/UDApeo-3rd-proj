import { Injectable } from '@nestjs/common';
import { CassandraService } from '../cassandra.service';
import { Employee } from '../../domain/employees/entities/employee.entity';
import { types } from 'cassandra-driver';

@Injectable()
export class CassandraEmployeeRepository {
  constructor(private readonly cassandraService: CassandraService) {}

  async create(employee: Employee): Promise<Employee> {
    const id = types.Uuid.random();
    const query = `
      INSERT INTO employees (
        id, first_name, middle_name, last_name, second_last_name, 
        display_name, company_email, personal_email, birthdate, 
        start_date, address, phone_number, bank_name, account_number, 
        gender, tags, country, region, city, effective_date, 
        salary, salary_type, is_active, working_hours_per_week,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      employee.firstName,
      employee.middleName || null,
      employee.lastName,
      employee.secondLastName || null,
      employee.displayName || null,
      employee.companyEmail,
      employee.personalEmail || null,
      employee.birthdate || null,
      employee.startDate,
      employee.address || null,
      employee.phoneNumber || null,
      employee.bankName || null,
      employee.accountNumber || null,
      employee.gender || null,
      employee.tags ? JSON.stringify(employee.tags) : null,
      employee.country,
      employee.region,
      employee.city,
      employee.effectiveDate,
      employee.salary,
      employee.salaryType,
      employee.isActive !== undefined ? employee.isActive : true,
      employee.workingHoursPerWeek || 40,
      new Date(),
      new Date(),
    ];

    await this.cassandraService.execute(query, params);
    
    employee.id = id.toString() as any; // Convert UUID to string for compatibility
    return employee;
  }

  async findById(id: string): Promise<Employee | null> {
    const query = 'SELECT * FROM employees WHERE id = ?';
    const result = await this.cassandraService.execute(query, [types.Uuid.fromString(id)]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEmployee(result.rows[0]);
  }

  async findAll(limit: number = 100): Promise<Employee[]> {
    const query = 'SELECT * FROM employees LIMIT ?';
    const result = await this.cassandraService.execute(query, [limit]);
    
    return result.rows.map(row => this.mapRowToEmployee(row));
  }

  async findByEmail(email: string): Promise<Employee | null> {
    const query = 'SELECT * FROM employees WHERE company_email = ? LIMIT 1 ALLOW FILTERING';
    const result = await this.cassandraService.execute(query, [email]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEmployee(result.rows[0]);
  }

  async findByCountry(country: string, limit: number = 100): Promise<Employee[]> {
    const query = 'SELECT * FROM employees WHERE country = ? LIMIT ? ALLOW FILTERING';
    const result = await this.cassandraService.execute(query, [country, limit]);
    
    return result.rows.map(row => this.mapRowToEmployee(row));
  }

  async update(id: string, employee: Partial<Employee>): Promise<Employee | null> {
    const updateFields: string[] = [];
    const params: any[] = [];

    if (employee.firstName) {
      updateFields.push('first_name = ?');
      params.push(employee.firstName);
    }
    if (employee.middleName !== undefined) {
      updateFields.push('middle_name = ?');
      params.push(employee.middleName);
    }
    if (employee.lastName) {
      updateFields.push('last_name = ?');
      params.push(employee.lastName);
    }
    if (employee.companyEmail) {
      updateFields.push('company_email = ?');
      params.push(employee.companyEmail);
    }
    if (employee.salary !== undefined) {
      updateFields.push('salary = ?');
      params.push(employee.salary);
    }
    // Add more fields as needed...

    if (updateFields.length === 0) {
      return this.findById(id);
    }

    updateFields.push('updated_at = ?');
    params.push(new Date());
    params.push(types.Uuid.fromString(id));

    const query = `UPDATE employees SET ${updateFields.join(', ')} WHERE id = ?`;
    await this.cassandraService.execute(query, params);
    
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM employees WHERE id = ?';
    await this.cassandraService.execute(query, [types.Uuid.fromString(id)]);
    return true;
  }

  private mapRowToEmployee(row: any): Employee {
    const employee = new Employee();
    employee.id = row.id.toString() as any;
    employee.firstName = row.first_name;
    employee.middleName = row.middle_name;
    employee.lastName = row.last_name;
    employee.secondLastName = row.second_last_name;
    employee.displayName = row.display_name;
    employee.companyEmail = row.company_email;
    employee.personalEmail = row.personal_email;
    employee.birthdate = row.birthdate;
    employee.startDate = row.start_date;
    employee.address = row.address;
    employee.phoneNumber = row.phone_number;
    employee.bankName = row.bank_name;
    employee.accountNumber = row.account_number;
    employee.gender = row.gender;
    employee.tags = row.tags ? JSON.parse(row.tags) : {};
    employee.country = row.country;
    employee.region = row.region;
    employee.city = row.city;
    employee.effectiveDate = row.effective_date;
    employee.salary = row.salary;
    employee.salaryType = row.salary_type;
    employee.isActive = row.is_active;
    employee.workingHoursPerWeek = row.working_hours_per_week;
    return employee;
  }
}
