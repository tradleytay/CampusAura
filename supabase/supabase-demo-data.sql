-- Optional CampusAura demo content.
-- Run after supabase-schema.sql to populate the empty site with sample records.

insert into public.accommodations
  (id, title, location, price, description, image_url, verified, status)
values
  ('00000000-0000-0000-0000-000000000001', 'Sunny Studio near North Campus', 'North Campus', 4500, 'Cozy studio with fast Wi-Fi and study desk.', 'images/room1.jpeg', true, 'published'),
  ('00000000-0000-0000-0000-000000000002', 'Shared Flat - 2 Beds', 'City Center', 3500, 'Affordable shared flat walking distance to campus.', 'images/room2.jpeg', true, 'published'),
  ('00000000-0000-0000-0000-000000000003', 'Modern Ensuite', 'South Campus', 6500, 'Private bathroom, new furniture, gym access.', 'images/room3.jpeg', true, 'published'),
  ('00000000-0000-0000-0000-000000000004', 'Basement Room - Budget', 'City Center', 2500, 'Budget-friendly option for students.', 'images/room4.jpeg', true, 'published'),
  ('00000000-0000-0000-0000-000000000005', 'Loft Apartment', 'North Campus', 9000, 'Spacious loft with balcony and workspace.', 'images/room5.jpeg', true, 'published')
on conflict (id) do nothing;

insert into public.marketplace_items
  (id, title, price, category, description, image_url, status)
values
  ('00000000-0000-0000-0000-000000000011', 'MacBook Pro 2019', 6500, 'Electronics', 'Reliable laptop for study and everyday work.', 'images/laptop.jpeg', 'published'),
  ('00000000-0000-0000-0000-000000000012', 'Calculus Textbook', 120, 'Books', 'Used textbook in good condition.', 'images/books.jpeg', 'published'),
  ('00000000-0000-0000-0000-000000000013', 'Vintage Jacket', 300, 'Fashion', 'Pre-owned jacket in excellent condition.', 'images/jacket.jpeg', 'published')
on conflict (id) do nothing;

insert into public.events
  (id, title, event_date, location, description, image_url, event_type, status)
values
  ('00000000-0000-0000-0000-000000000021', 'Welcome Week Fair', '2026-10-04 10:00:00+00', 'Student Quad', 'Meet students, clubs, and campus organisations.', 'images/event1.jpeg', 'social', 'published'),
  ('00000000-0000-0000-0000-000000000022', 'Career Night', '2026-10-20 18:00:00+00', 'Auditorium', 'Meet employers and explore early career opportunities.', 'images/event5.jpeg', 'career', 'published'),
  ('00000000-0000-0000-0000-000000000023', 'Open Mic Night', '2026-10-28 19:00:00+00', 'Commons', 'An evening of music, poetry, and student performances.', 'images/event4.jpeg', 'social', 'published')
on conflict (id) do nothing;