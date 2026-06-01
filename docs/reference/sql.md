# SQL Reference

WDK's SQL engine executes SELECT queries against in-memory DataFrames. It is not a full SQL parser — it covers the analytical queries data engineers and analysts actually run.

## Syntax overview

```sql
SELECT columns
FROM table [AS alias]
[JOIN table [AS alias] ON condition]
[UNPIVOT (value_col FOR name_col IN (col1, col2, ...))]
[WHERE condition]
[GROUP BY columns]
[ORDER BY columns [ASC|DESC]]
[LIMIT n]
```

## Tables

Each imported dataset is a named table. The first import is `data`. Subsequent imports use the filename (without extension). Reference tables by name in FROM and JOIN clauses.

## SELECT

```sql
-- All columns
SELECT * FROM data

-- Specific columns
SELECT name, salary FROM data

-- Aliases
SELECT name AS employee_name, salary * 12 AS annual FROM data

-- Expressions in SELECT
SELECT name, UPPER(department) AS dept FROM data
```

## WHERE

Standard comparison operators: `=`, `!=`, `<>`, `<`, `>`, `<=`, `>=`.

```sql
SELECT * FROM data WHERE salary > 50000
SELECT * FROM data WHERE department = 'Engineering'
SELECT * FROM data WHERE name LIKE '%ali%'
SELECT * FROM data WHERE salary >= 70000 AND department = 'Marketing'
SELECT * FROM data WHERE status IS NULL
SELECT * FROM data WHERE status IS NOT NULL
```

### LIKE
- `%` matches any sequence of characters.
- `_` matches any single character.

```sql
SELECT * FROM data WHERE name LIKE 'A%'       -- starts with A
SELECT * FROM data WHERE email LIKE '%@gov.%'  -- contains @gov.
```

### Boolean logic
```sql
SELECT * FROM data WHERE (salary > 80000 OR department = 'Engineering') AND active = 'true'
```

## JOIN

Supports INNER, LEFT, RIGHT, and CROSS joins. Multiple joins can be chained.

```sql
-- INNER JOIN
SELECT a.name, b.department_name
FROM employees AS a
INNER JOIN departments AS b ON a.dept_id = b.id

-- LEFT JOIN (keeps all rows from left table)
SELECT a.name, b.manager
FROM employees AS a
LEFT JOIN managers AS b ON a.manager_id = b.id

-- RIGHT JOIN (keeps all rows from right table)
SELECT a.order_id, b.name
FROM orders AS a
RIGHT JOIN customers AS b ON a.customer_id = b.id

-- CROSS JOIN (cartesian product)
SELECT a.size, b.color
FROM sizes AS a
CROSS JOIN colors AS b
```

### Multi-column joins
```sql
SELECT *
FROM orders AS a
INNER JOIN inventory AS b ON a.product_id = b.product_id AND a.warehouse = b.warehouse
```

## GROUP BY

Aggregation functions: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`.

```sql
SELECT department, COUNT(*) AS headcount, AVG(salary) AS avg_salary
FROM data
GROUP BY department

SELECT department, YEAR(hire_date) AS hire_year, COUNT(*) AS hired
FROM data
GROUP BY department, YEAR(hire_date)
```

`COUNT(*)` counts all rows. `COUNT(column)` counts non-null values.

## ORDER BY

```sql
SELECT * FROM data ORDER BY salary DESC
SELECT * FROM data ORDER BY department ASC, salary DESC
```

Default direction is ASC.

## LIMIT

```sql
SELECT * FROM data ORDER BY salary DESC LIMIT 10
```

## UNPIVOT

Transform columns into rows. Useful for normalizing wide tables.

```sql
SELECT *
FROM data
UNPIVOT (score FOR subject IN (math, science, english))
```

Before UNPIVOT:
| name | math | science | english |
|------|------|---------|---------|
| Alice | 95 | 88 | 92 |

After UNPIVOT:
| name | subject | score |
|------|---------|-------|
| Alice | math | 95 |
| Alice | science | 88 |
| Alice | english | 92 |

## FILL_DOWN

Fill null/empty values in a column with the last non-null value. Useful for merged-cell spreadsheet data.

```sql
SELECT *, FILL_DOWN(category) AS category_filled FROM data
```

## Window functions

Window functions compute values across rows related to the current row without collapsing groups.

### ROW_NUMBER

```sql
SELECT name, department, salary,
  ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS row_num
FROM data
```

### RANK

```sql
SELECT name, salary,
  RANK() OVER (ORDER BY salary DESC) AS salary_rank
FROM data
```

RANK assigns the same rank to tied values and skips subsequent ranks (1, 2, 2, 4).

### LAG / LEAD

Access previous or next row values.

```sql
-- Previous row's salary
SELECT name, salary,
  LAG(salary) OVER (ORDER BY hire_date) AS prev_salary
FROM data

-- Next row's salary
SELECT name, salary,
  LEAD(salary) OVER (ORDER BY hire_date) AS next_salary
FROM data
```

### Aggregate window functions

SUM, AVG, COUNT, MIN, MAX can be used as window functions with OVER.

```sql
SELECT name, department, salary,
  SUM(salary) OVER (PARTITION BY department) AS dept_total,
  AVG(salary) OVER (PARTITION BY department) AS dept_avg,
  COUNT(*) OVER (PARTITION BY department) AS dept_count
FROM data
```

## Built-in functions

### String functions (17)

| Function | Syntax | Description |
|----------|--------|-------------|
| `UPPER` | `UPPER(str)` | Convert to uppercase |
| `LOWER` | `LOWER(str)` | Convert to lowercase |
| `TRIM` | `TRIM(str)` | Remove leading and trailing whitespace |
| `LTRIM` | `LTRIM(str)` | Remove leading whitespace |
| `RTRIM` | `RTRIM(str)` | Remove trailing whitespace |
| `LENGTH` | `LENGTH(str)` | String length (alias: `LEN`) |
| `SUBSTR` | `SUBSTR(str, start, len)` | Substring (1-indexed start; alias: `SUBSTRING`) |
| `REPLACE` | `REPLACE(str, find, rep)` | Replace all occurrences |
| `CONCAT` | `CONCAT(a, b, ...)` | Concatenate strings (nulls become empty) |
| `LEFT` | `LEFT(str, n)` | First n characters |
| `RIGHT` | `RIGHT(str, n)` | Last n characters |
| `INSTR` | `INSTR(str, sub)` | Position of substring (1-indexed, 0 if not found) |
| `REVERSE` | `REVERSE(str)` | Reverse string |
| `REPEAT` | `REPEAT(str, n)` | Repeat string n times |
| `LPAD` | `LPAD(str, len, pad)` | Left-pad to length with pad string |
| `RPAD` | `RPAD(str, len, pad)` | Right-pad to length with pad string |
| `SPLIT` | `SPLIT(str, delim, idx)` | Split by delimiter, return element at index (0-based) |

### Advanced string functions (2)

| Function | Syntax | Description |
|----------|--------|-------------|
| `REGEX_EXTRACT` | `REGEX_EXTRACT(str, pattern, group)` | First regex match (or capture group) |
| `REGEX_REPLACE` | `REGEX_REPLACE(str, pattern, rep)` | Regex replace (global) |

### Date functions (10)

| Function | Syntax | Description |
|----------|--------|-------------|
| `YEAR` | `YEAR(date)` | Extract year |
| `MONTH` | `MONTH(date)` | Extract month (1-12) |
| `DAY` | `DAY(date)` | Extract day of month |
| `HOUR` | `HOUR(date)` | Extract hour (0-23) |
| `MINUTE` | `MINUTE(date)` | Extract minute |
| `SECOND` | `SECOND(date)` | Extract second |
| `DATE` | `DATE(date)` | Convert to `YYYY-MM-DD` string |
| `DATEDIFF` | `DATEDIFF(date1, date2)` | Days between two dates (`date2 - date1`) |
| `DATEADD` | `DATEADD(date, days)` | Add days to a date |
| `NOW` | `NOW()` | Current timestamp (ISO 8601) |
| `TODAY` | `TODAY()` | Current date (`YYYY-MM-DD`) |

Date parsing recognizes ISO 8601, `MM/DD/YYYY`, `YYYY-MM-DD`, and other common formats.

### Math functions (8)

| Function | Syntax | Description |
|----------|--------|-------------|
| `ABS` | `ABS(n)` | Absolute value |
| `ROUND` | `ROUND(n, decimals)` | Round to decimal places |
| `CEIL` | `CEIL(n)` | Round up (alias: `CEILING`) |
| `FLOOR` | `FLOOR(n)` | Round down |
| `SQRT` | `SQRT(n)` | Square root (null for negative) |
| `POWER` | `POWER(base, exp)` | Exponentiation |
| `MOD` | `MOD(n, divisor)` | Modulo / remainder |
| `LOG` | `LOG(n)` | Natural logarithm (null for non-positive) |

### Type and null functions (6)

| Function | Syntax | Description |
|----------|--------|-------------|
| `COALESCE` | `COALESCE(a, b, ...)` | First non-null, non-empty value (alias: `IFNULL`) |
| `NULLIF` | `NULLIF(a, b)` | Returns null if `a == b`, else `a` |
| `CAST_INT` | `CAST_INT(val)` | Parse as integer (null on failure) |
| `CAST_FLOAT` | `CAST_FLOAT(val)` | Parse as float (null on failure) |
| `TYPEOF` | `TYPEOF(val)` | Returns: `null`, `integer`, `real`, `date`, or `text` |
| `IIF` | `IIF(cond, true_val, false_val)` | Inline conditional |

## Examples

### Top departments by average salary
```sql
SELECT department, COUNT(*) AS size, ROUND(AVG(salary), 0) AS avg_sal
FROM employees
GROUP BY department
ORDER BY avg_sal DESC
LIMIT 5
```

### Year-over-year hires
```sql
SELECT YEAR(hire_date) AS yr, COUNT(*) AS hires
FROM employees
GROUP BY YEAR(hire_date)
ORDER BY yr
```

### Running total with window function
```sql
SELECT name, hire_date, salary,
  SUM(salary) OVER (ORDER BY hire_date) AS running_total
FROM employees
```

### Find duplicates
```sql
SELECT email, COUNT(*) AS cnt
FROM contacts
GROUP BY email
ORDER BY cnt DESC
LIMIT 20
```

### Cross-table analysis with JOIN
```sql
SELECT e.name, e.salary, d.budget,
  ROUND(e.salary / d.budget * 100, 1) AS pct_of_budget
FROM employees AS e
INNER JOIN departments AS d ON e.dept_id = d.id
WHERE d.budget > 0
ORDER BY pct_of_budget DESC
```

### Clean and normalize data
```sql
SELECT TRIM(UPPER(name)) AS name_clean,
  REPLACE(phone, '-', '') AS phone_digits,
  COALESCE(email, 'unknown') AS email
FROM contacts
```
