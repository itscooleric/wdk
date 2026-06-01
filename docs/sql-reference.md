# WDK SQL Reference

## Syntax

```sql
SELECT [columns | * | aggregates | window_functions]
FROM table [AS alias]
[JOIN table [AS alias] ON condition [AND condition ...]]
[WHERE condition [AND|OR condition ...]]
[GROUP BY column [, column ...]]
[ORDER BY column [ASC|DESC] [, column ...]]
[LIMIT n]
```

## JOINs

```sql
-- INNER JOIN (only matching rows)
SELECT a.name, b.dept FROM employees AS a INNER JOIN departments AS b ON a.dept_id = b.id

-- LEFT JOIN (all left rows, NULL for unmatched right)
SELECT a.name, b.dept FROM employees AS a LEFT JOIN departments AS b ON a.dept_id = b.id

-- RIGHT JOIN (all right rows, NULL for unmatched left)
SELECT a.name, b.dept FROM employees AS a RIGHT JOIN departments AS b ON a.dept_id = b.id

-- CROSS JOIN (cartesian product)
SELECT a.size, b.color FROM sizes AS a CROSS JOIN colors AS b

-- Multi-condition JOIN
SELECT * FROM orders AS a JOIN customers AS b ON a.cust_id = b.id AND a.region = b.region
```

## Aggregates

| Function | Description |
|---|---|
| `COUNT(*)` | Count rows |
| `COUNT(col)` | Count non-null values |
| `SUM(col)` | Sum numeric values |
| `AVG(col)` | Average numeric values |
| `MIN(col)` | Minimum value |
| `MAX(col)` | Maximum value |

## Window Functions

```sql
-- ROW_NUMBER: sequential numbering within partition
SELECT name, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM employees

-- RANK: rank with gaps for ties
SELECT name, RANK() OVER (ORDER BY score DESC) AS rank FROM scores

-- LAG/LEAD: access previous/next row values
SELECT date, value, LAG(value, 1, 0) OVER (ORDER BY date) AS prev_value FROM timeseries
SELECT date, value, LEAD(value, 1, 0) OVER (ORDER BY date) AS next_value FROM timeseries

-- Cumulative SUM (with ORDER BY)
SELECT date, amount, SUM(amount) OVER (ORDER BY date) AS running_total FROM transactions

-- Partition-wide aggregates (without ORDER BY)
SELECT name, salary, AVG(salary) OVER (PARTITION BY dept) AS dept_avg FROM employees
SELECT name, COUNT(*) OVER (PARTITION BY dept) AS dept_count FROM employees
```

## WHERE Operators

| Operator | Example |
|---|---|
| `=` | `WHERE status = 'active'` |
| `!=` / `<>` | `WHERE status != 'deleted'` |
| `>` `<` `>=` `<=` | `WHERE salary > 50000` |
| `LIKE` | `WHERE name LIKE '%smith%'` (`%` = any, `_` = one char) |
| `AND` | `WHERE age > 18 AND status = 'active'` |
| `OR` | `WHERE dept = 'sales' OR dept = 'marketing'` |

## Built-in Functions (61)

### String Functions

| Function | Description | Example |
|---|---|---|
| `UPPER(s)` | Uppercase | `UPPER('hello')` → `'HELLO'` |
| `LOWER(s)` | Lowercase | `LOWER('HELLO')` → `'hello'` |
| `TRIM(s)` | Remove whitespace | `TRIM('  hi  ')` → `'hi'` |
| `LTRIM(s)` | Trim left | `LTRIM('  hi')` → `'hi'` |
| `RTRIM(s)` | Trim right | `RTRIM('hi  ')` → `'hi'` |
| `LENGTH(s)` / `LEN(s)` | String length | `LENGTH('hello')` → `5` |
| `SUBSTR(s, start [, len])` | Substring (1-indexed) | `SUBSTR('hello', 2, 3)` → `'ell'` |
| `REPLACE(s, find, rep)` | Replace all | `REPLACE('abc', 'b', 'x')` → `'axc'` |
| `CONCAT(a, b, ...)` | Concatenate | `CONCAT('a', 'b', 'c')` → `'abc'` |
| `LEFT(s, n)` | Left n chars | `LEFT('hello', 3)` → `'hel'` |
| `RIGHT(s, n)` | Right n chars | `RIGHT('hello', 3)` → `'llo'` |
| `INSTR(s, sub)` | Find position (1-indexed, 0=not found) | `INSTR('hello', 'lo')` → `4` |
| `REVERSE(s)` | Reverse string | `REVERSE('hello')` → `'olleh'` |
| `REPEAT(s, n)` | Repeat n times | `REPEAT('ab', 3)` → `'ababab'` |
| `LPAD(s, len, pad)` | Left-pad | `LPAD('42', 5, '0')` → `'00042'` |
| `RPAD(s, len, pad)` | Right-pad | `RPAD('hi', 5, '.')` → `'hi...'` |

### Date Functions

| Function | Description | Example |
|---|---|---|
| `YEAR(d)` | Extract year | `YEAR('2026-04-03')` → `2026` |
| `MONTH(d)` | Extract month | `MONTH('2026-04-03')` → `4` |
| `DAY(d)` | Extract day | `DAY('2026-04-03')` → `3` |
| `HOUR(d)` | Extract hour | `HOUR('2026-04-03T15:30:00')` → `15` |
| `MINUTE(d)` | Extract minute | |
| `SECOND(d)` | Extract second | |
| `DATE(d)` | Extract date part | `DATE('2026-04-03T15:30:00Z')` → `'2026-04-03'` |
| `DATEDIFF(d1, d2)` | Days between | `DATEDIFF('2026-01-01', '2026-01-31')` → `30` |
| `DATEADD(d, days)` | Add days | `DATEADD('2026-01-01', 10)` → `'2026-01-11'` |
| `NOW()` | Current datetime (ISO) | |
| `TODAY()` | Current date | |

### Math Functions

| Function | Description | Example |
|---|---|---|
| `ABS(n)` | Absolute value | `ABS(-5)` → `5` |
| `ROUND(n [, decimals])` | Round | `ROUND(3.14159, 2)` → `3.14` |
| `CEIL(n)` / `CEILING(n)` | Ceiling | `CEIL(3.2)` → `4` |
| `FLOOR(n)` | Floor | `FLOOR(3.8)` → `3` |
| `SQRT(n)` | Square root | `SQRT(9)` → `3` |
| `POWER(n, exp)` | Power | `POWER(2, 3)` → `8` |
| `MOD(n, div)` | Modulo | `MOD(10, 3)` → `1` |
| `LOG(n)` | Natural log | `LOG(2.718)` → `~1` |

### Type / Null Functions

| Function | Description | Example |
|---|---|---|
| `COALESCE(a, b, ...)` | First non-null/non-empty | `COALESCE(null, '', 'hi')` → `'hi'` |
| `IFNULL(a, b)` | If null, use default | `IFNULL(null, 'N/A')` → `'N/A'` |
| `NULLIF(a, b)` | Null if equal | `NULLIF(5, 5)` → `null` |
| `CAST_INT(s)` | Parse integer | `CAST_INT('42')` → `42` |
| `CAST_FLOAT(s)` | Parse float | `CAST_FLOAT('3.14')` → `3.14` |
| `TYPEOF(v)` | Type name | `TYPEOF('hello')` → `'text'` |
| `IIF(cond, then, else)` | Conditional | `IIF(1, 'yes', 'no')` → `'yes'` |
