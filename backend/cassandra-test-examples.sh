#!/bin/bash

# Cassandra Test Examples
# This script provides example curl commands to test the Cassandra endpoints

BASE_URL="http://localhost:3030"

echo "================================"
echo "Cassandra Test API Examples"
echo "================================"
echo ""

echo "1. Create an Employee"
echo "curl -X POST $BASE_URL/cassandra-test/employees \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"firstName\": \"John\","
echo "    \"lastName\": \"Doe\","
echo "    \"companyEmail\": \"john.doe@company.com\","
echo "    \"country\": \"USA\","
echo "    \"region\": \"California\","
echo "    \"city\": \"San Francisco\","
echo "    \"startDate\": \"2024-01-01\","
echo "    \"effectiveDate\": \"2024-01-01\","
echo "    \"salary\": 100000,"
echo "    \"salaryType\": \"yearly\""
echo "  }'"
echo ""

echo "2. Get All Employees"
echo "curl -X GET $BASE_URL/cassandra-test/employees"
echo ""

echo "3. Get Employee by ID (replace {id} with actual UUID)"
echo "curl -X GET $BASE_URL/cassandra-test/employees/{id}"
echo ""

echo "4. Create a Product"
echo "curl -X POST $BASE_URL/cassandra-test/products \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"description\": \"Test Product\""
echo "  }'"
echo ""

echo "5. Get All Products"
echo "curl -X GET $BASE_URL/cassandra-test/products"
echo ""

echo "6. Create an Order"
echo "curl -X POST $BASE_URL/cassandra-test/orders \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"id\": \"$(uuidgen)\""
echo "  }'"
echo ""

echo "7. Get All Orders"
echo "curl -X GET $BASE_URL/cassandra-test/orders"
echo ""

echo "8. Add Product to Order (replace {orderId} and {productId})"
echo "curl -X POST $BASE_URL/cassandra-test/orders/{orderId}/products/{productId}"
echo ""

echo "9. Delete Employee (replace {id})"
echo "curl -X DELETE $BASE_URL/cassandra-test/employees/{id}"
echo ""

echo "================================"
echo "Direct CQL Commands"
echo "================================"
echo ""
echo "Connect to Cassandra:"
echo "docker exec -it cassandra cqlsh"
echo ""
echo "Then run these CQL commands:"
echo "USE glee;"
echo "DESCRIBE TABLES;"
echo "SELECT * FROM employees LIMIT 10;"
echo "SELECT * FROM products LIMIT 10;"
echo "SELECT * FROM orders LIMIT 10;"
echo ""
