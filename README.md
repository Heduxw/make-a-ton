# make-a-ton
What we need to build
--Front-End
* Admin Page
* Customer Page
* Finance Team Page
* Sales Rep Page

--Back-End
Backend for Brightloop’s Subscription Management System

I’d build this as a modular monolith with a relational database. Billing data needs transactions, constraints and joins, so a microservice or NoSQL approach would add complexity for no gain.

Suggested stack
* API: Node.js with NestJS or Express (or Django REST or Spring Boot if you prefer)
* Database: PostgreSQL, with Prisma, TypeORM or SQLAlchemy as the ORM
* Jobs: Redis with BullMQ (or Celery or cron) for the billing run, renewals and overdue checks
* Auth: JWT or sessions, bcrypt/argon2 password hashing, role-based guards
* Email: Nodemailer or SES for reset links and invoice sending
* PDF: Puppeteer or PDFKit for printing invoices
Modules
* Auth and users: signup, login, forgot/reset password, roles (admin, staff, customer)
* Products and variants
* Plans
* Quotation templates
* Subscriptions (with lines and a status workflow)
* Taxes
* Discounts
* Invoices (with lines and a status workflow)
* Payments
* Reports and dashboard
* Scheduler, the background jobs that make billing automatic

*BEST OF LUCK!