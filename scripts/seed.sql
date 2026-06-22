INSERT INTO products (name, category, price, created_at, updated_at)
SELECT
  'Product ' || g.i,
  (ARRAY[
    'electronics', 'books', 'clothing', 'home', 'sports',
    'toys', 'garden', 'automotive', 'health', 'food'
  ])[1 + (g.i % 10)],
  (random() * 500 + 0.99)::numeric(10, 2),
  now() - (random() * interval '365 days'),
  now() - (random() * interval '30 days')
FROM generate_series(1, 200000) AS g(i);
