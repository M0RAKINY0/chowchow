process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://postgres:morak321@localhost:5432/food_ordering_test?schema=public";
process.env.REDIS_URL = "redis://localhost:6379/1";
process.env.JWT_ACCESS_SECRET = "test-access-secret-chowchow-2026";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-chowchow-2026";
process.env.EMAIL_PROVIDER = "console";
process.env.EMAIL_FROM = "onboarding@resend.dev";
