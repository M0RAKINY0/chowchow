declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        id: string;
        role: "CUSTOMER" | "VENDOR" | "ADMIN";
      };
    }
  }
}

export {};
