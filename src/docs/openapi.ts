const bearerAuth = [{ bearerAuth: [] }];
const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { "application/json": { schema } },
});
const dataResponse = (
  schema: Record<string, unknown>,
  description = "Success",
) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/DataResponse" },
      examples: { response: { value: { data: schema } } },
    },
  },
});

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Chowchow Backend API",
    version: "0.1.0",
    description:
      "Backend-only multi-vendor food ordering API demo. Money values are integer Nigerian naira kobo.",
  },
  servers: [{ url: "http://localhost:4000", description: "Local development" }],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Vendors" },
    { name: "Menus" },
    { name: "Popular food" },
    { name: "Carts" },
    { name: "Checkout" },
    { name: "Orders" },
  ],
  paths: {
    "/health/live": {
      get: {
        tags: ["Health"],
        summary: "Liveness probe",
        responses: { "200": { description: "Process is running" } },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Health"],
        summary: "Readiness probe",
        responses: { "200": { description: "API is ready" } },
      },
    },
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a customer",
        requestBody: jsonBody({ $ref: "#/components/schemas/RegisterInput" }),
        responses: {
          "201": dataResponse({ $ref: "#/components/schemas/AuthResponse" }),
          "400": { $ref: "#/components/responses/ValidationError" },
          "409": { $ref: "#/components/responses/ConflictError" },
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login and issue access/refresh tokens",
        requestBody: jsonBody({ $ref: "#/components/schemas/LoginInput" }),
        responses: {
          "200": dataResponse({ $ref: "#/components/schemas/AuthResponse" }),
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate a refresh token",
        requestBody: jsonBody({ $ref: "#/components/schemas/RefreshInput" }),
        responses: {
          "200": dataResponse({ $ref: "#/components/schemas/AuthResponse" }),
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke a refresh token",
        requestBody: jsonBody({ $ref: "#/components/schemas/RefreshInput" }),
        responses: {
          "204": { description: "Refresh token revoked" },
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get the current user",
        security: bearerAuth,
        responses: {
          "200": dataResponse({ user: { $ref: "#/components/schemas/User" } }),
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/api/v1/vendors": {
      get: {
        tags: ["Vendors"],
        summary: "List active vendors",
        parameters: [
          { $ref: "#/components/parameters/Search" },
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
        ],
        responses: {
          "200": dataResponse({
            items: [{ $ref: "#/components/schemas/Vendor" }],
            pagination: { $ref: "#/components/schemas/Pagination" },
          }),
        },
      },
      post: {
        tags: ["Vendors"],
        summary: "Create a vendor",
        description: "Admin only.",
        security: bearerAuth,
        requestBody: jsonBody({
          $ref: "#/components/schemas/CreateVendorInput",
        }),
        responses: {
          "201": dataResponse({
            vendor: { $ref: "#/components/schemas/Vendor" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}": {
      parameters: [{ $ref: "#/components/parameters/VendorId" }],
      get: {
        tags: ["Vendors"],
        summary: "Get an active vendor",
        responses: {
          "200": dataResponse({
            vendor: { $ref: "#/components/schemas/Vendor" },
          }),
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
      patch: {
        tags: ["Vendors"],
        summary: "Update a vendor",
        description: "Admin only.",
        security: bearerAuth,
        requestBody: jsonBody({
          $ref: "#/components/schemas/UpdateVendorInput",
        }),
        responses: {
          "200": dataResponse({
            vendor: { $ref: "#/components/schemas/Vendor" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}/menu": {
      get: {
        tags: ["Menus"],
        summary: "Browse an active vendor menu",
        parameters: [{ $ref: "#/components/parameters/VendorId" }],
        responses: {
          "200": dataResponse({
            vendor: { $ref: "#/components/schemas/Vendor" },
            categories: [{ $ref: "#/components/schemas/MenuCategory" }],
          }),
        },
      },
    },
    "/api/v1/vendors/{vendorId}/popular-items": {
      get: {
        tags: ["Popular food"],
        summary: "List most ordered available food",
        description:
          "Uses a five-minute Redis cache backed by PostgreSQL aggregation. Cancelled orders are excluded; Redis failures fall back to PostgreSQL.",
        parameters: [
          { $ref: "#/components/parameters/VendorId" },
          { $ref: "#/components/parameters/PopularLimit" },
        ],
        responses: {
          "200": dataResponse({
            source: { type: "string", enum: ["cache", "database"] },
            items: [{ $ref: "#/components/schemas/PopularFoodItem" }],
          }),
          "404": { $ref: "#/components/responses/NotFoundError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}/categories": {
      post: {
        tags: ["Menus"],
        summary: "Create a menu category",
        description: "Vendor member or admin.",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/VendorId" }],
        requestBody: jsonBody({
          $ref: "#/components/schemas/CreateCategoryInput",
        }),
        responses: {
          "201": dataResponse({
            category: { $ref: "#/components/schemas/MenuCategory" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}/categories/{categoryId}": {
      patch: {
        tags: ["Menus"],
        summary: "Update a menu category",
        description: "Vendor member or admin.",
        security: bearerAuth,
        parameters: [
          { $ref: "#/components/parameters/VendorId" },
          { $ref: "#/components/parameters/CategoryId" },
        ],
        requestBody: jsonBody({
          $ref: "#/components/schemas/UpdateCategoryInput",
        }),
        responses: {
          "200": dataResponse({
            category: { $ref: "#/components/schemas/MenuCategory" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}/menu-items": {
      post: {
        tags: ["Menus"],
        summary: "Create a menu item",
        description: "Vendor member or admin.",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/VendorId" }],
        requestBody: jsonBody({
          $ref: "#/components/schemas/CreateMenuItemInput",
        }),
        responses: {
          "201": dataResponse({
            menuItem: { $ref: "#/components/schemas/MenuItem" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}/menu-items/{menuItemId}": {
      patch: {
        tags: ["Menus"],
        summary: "Update menu item availability or details",
        description:
          "Vendor member or admin. Updating the item invalidates popular-food cache.",
        security: bearerAuth,
        parameters: [
          { $ref: "#/components/parameters/VendorId" },
          { $ref: "#/components/parameters/MenuItemId" },
        ],
        requestBody: jsonBody({
          $ref: "#/components/schemas/UpdateMenuItemInput",
        }),
        responses: {
          "200": dataResponse({
            menuItem: { $ref: "#/components/schemas/MenuItem" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/carts/{vendorId}": {
      get: {
        tags: ["Carts"],
        summary: "Get the authenticated customer's vendor cart",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/VendorId" }],
        responses: {
          "200": dataResponse({ cart: { $ref: "#/components/schemas/Cart" } }),
          "401": { $ref: "#/components/responses/UnauthorizedError" },
        },
      },
    },
    "/api/v1/carts/{vendorId}/items": {
      post: {
        tags: ["Carts"],
        summary: "Add an item to a vendor cart",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/VendorId" }],
        requestBody: jsonBody({
          $ref: "#/components/schemas/AddCartItemInput",
        }),
        responses: {
          "201": dataResponse({ cart: { $ref: "#/components/schemas/Cart" } }),
          "409": { $ref: "#/components/responses/ConflictError" },
        },
      },
    },
    "/api/v1/carts/{vendorId}/items/{cartItemId}": {
      parameters: [
        { $ref: "#/components/parameters/VendorId" },
        { $ref: "#/components/parameters/CartItemId" },
      ],
      patch: {
        tags: ["Carts"],
        summary: "Update cart item quantity",
        security: bearerAuth,
        requestBody: jsonBody({
          $ref: "#/components/schemas/UpdateCartItemInput",
        }),
        responses: {
          "200": dataResponse({ cart: { $ref: "#/components/schemas/Cart" } }),
        },
      },
      delete: {
        tags: ["Carts"],
        summary: "Remove an item from a cart",
        security: bearerAuth,
        responses: { "204": { description: "Cart item removed" } },
      },
    },
    "/api/v1/checkout": {
      post: {
        tags: ["Checkout"],
        summary: "Create an order from a cart",
        description:
          "Requires an Idempotency-Key header. Checkout snapshots prices and delivery address, creates a transactional notification outbox record, and is safe to retry.",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: jsonBody({ $ref: "#/components/schemas/CheckoutInput" }),
        responses: {
          "201": dataResponse({
            $ref: "#/components/schemas/CheckoutResponse",
          }),
          "200": dataResponse(
            { $ref: "#/components/schemas/CheckoutResponse" },
            "Idempotent replay",
          ),
          "409": { $ref: "#/components/responses/ConflictError" },
        },
      },
    },
    "/api/v1/orders": {
      get: {
        tags: ["Orders"],
        summary: "List orders visible to the authenticated actor",
        security: bearerAuth,
        parameters: [
          { $ref: "#/components/parameters/OptionalVendorId" },
          { $ref: "#/components/parameters/OptionalCustomerId" },
          { $ref: "#/components/parameters/OrderStatus" },
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
        ],
        responses: {
          "200": dataResponse({
            items: [{ $ref: "#/components/schemas/Order" }],
            pagination: { $ref: "#/components/schemas/Pagination" },
          }),
        },
      },
    },
    "/api/v1/orders/{orderId}": {
      get: {
        tags: ["Orders"],
        summary: "Get an order visible to the authenticated actor",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/OrderId" }],
        responses: {
          "200": dataResponse({
            order: { $ref: "#/components/schemas/Order" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
    "/api/v1/orders/{orderId}/status": {
      patch: {
        tags: ["Orders"],
        summary: "Advance an order through its lifecycle",
        description:
          "Vendor members and admins operate orders; customers may only cancel before preparation.",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/OrderId" }],
        requestBody: jsonBody({
          $ref: "#/components/schemas/UpdateOrderStatusInput",
        }),
        responses: {
          "200": dataResponse({
            order: { $ref: "#/components/schemas/Order" },
          }),
          "409": { $ref: "#/components/responses/ConflictError" },
        },
      },
    },
    "/api/v1/orders/{orderId}/cancel": {
      post: {
        tags: ["Orders"],
        summary: "Cancel an order when allowed",
        security: bearerAuth,
        parameters: [{ $ref: "#/components/parameters/OrderId" }],
        requestBody: jsonBody({
          $ref: "#/components/schemas/CancelOrderInput",
        }),
        responses: {
          "200": dataResponse({
            order: { $ref: "#/components/schemas/Order" },
          }),
          "409": { $ref: "#/components/responses/ConflictError" },
        },
      },
    },
    "/api/v1/vendors/{vendorId}/orders": {
      get: {
        tags: ["Orders"],
        summary: "List orders for a vendor",
        description: "Vendor members and admins only.",
        security: bearerAuth,
        parameters: [
          { $ref: "#/components/parameters/VendorId" },
          { $ref: "#/components/parameters/OrderStatus" },
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
        ],
        responses: {
          "200": dataResponse({
            items: [{ $ref: "#/components/schemas/Order" }],
            pagination: { $ref: "#/components/schemas/Pagination" },
          }),
          "403": { $ref: "#/components/responses/ForbiddenError" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    parameters: {
      VendorId: {
        name: "vendorId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      OptionalVendorId: {
        name: "vendorId",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
      },
      OptionalCustomerId: {
        name: "customerId",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
      },
      CategoryId: {
        name: "categoryId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      MenuItemId: {
        name: "menuItemId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      CartItemId: {
        name: "cartItemId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      OrderId: {
        name: "orderId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      Search: {
        name: "search",
        in: "query",
        required: false,
        schema: { type: "string", maxLength: 100 },
      },
      Limit: {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      PopularLimit: {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      Offset: {
        name: "offset",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 0, default: 0 },
      },
      OrderStatus: {
        name: "status",
        in: "query",
        required: false,
        schema: { $ref: "#/components/schemas/OrderStatus" },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", maxLength: 255 },
      },
    },
    responses: {
      ValidationError: {
        description: "Request validation failed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      UnauthorizedError: {
        description: "Authentication failed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      ForbiddenError: {
        description: "Actor is not allowed to perform this operation",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      NotFoundError: {
        description: "Resource was not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
      ConflictError: {
        description: "Operation conflicts with current state",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
    },
    schemas: {
      DataResponse: {
        type: "object",
        required: ["data"],
        properties: { data: {} },
      },
      ErrorEnvelope: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
              requestId: { type: "string", format: "uuid" },
            },
          },
        },
      },
      User: {
        type: "object",
        required: ["id", "email", "fullName", "role", "isActive"],
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          fullName: { type: "string" },
          role: { type: "string", enum: ["CUSTOMER", "VENDOR", "ADMIN"] },
          isActive: { type: "boolean" },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          accessTokenExpiresIn: { type: "integer", description: "Seconds" },
        },
      },
      RegisterInput: {
        type: "object",
        required: ["email", "fullName", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          fullName: { type: "string", minLength: 2, maxLength: 100 },
          password: { type: "string", minLength: 12, maxLength: 128 },
        },
      },
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      RefreshInput: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string" } },
      },
      Vendor: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          slug: { type: "string" },
          deliveryFeeKobo: { type: "integer", minimum: 0 },
          notificationEmail: { type: "string", format: "email" },
          isActive: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      MenuItem: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          priceKobo: { type: "integer", minimum: 1 },
          imageUrl: { type: "string", format: "uri", nullable: true },
          isAvailable: { type: "boolean" },
          categoryId: { type: "string", format: "uuid", nullable: true },
        },
      },
      MenuCategory: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          sortOrder: { type: "integer" },
          isActive: { type: "boolean" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/MenuItem" },
          },
        },
      },
      PopularFoodItem: {
        allOf: [
          { $ref: "#/components/schemas/MenuItem" },
          {
            type: "object",
            required: ["orderCount"],
            properties: { orderCount: { type: "integer", minimum: 1 } },
          },
        ],
      },
      Cart: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid", nullable: true },
          customerId: { type: "string", format: "uuid", nullable: true },
          vendorId: { type: "string", format: "uuid", nullable: true },
          items: { type: "array", items: { type: "object" } },
        },
      },
      Order: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          orderNumber: { type: "string" },
          customerId: { type: "string", format: "uuid" },
          vendorId: { type: "string", format: "uuid" },
          status: { $ref: "#/components/schemas/OrderStatus" },
          currency: { type: "string", example: "NGN" },
          subtotalKobo: { type: "integer" },
          deliveryFeeKobo: { type: "integer" },
          totalKobo: { type: "integer" },
          deliveryAddress: { type: "string" },
          deliveryNote: { type: "string", nullable: true },
          items: { type: "array", items: { type: "object" } },
          statusHistory: { type: "array", items: { type: "object" } },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          offset: { type: "integer" },
          total: { type: "integer" },
          hasMore: { type: "boolean" },
        },
      },
      CreateVendorInput: {
        type: "object",
        required: ["name", "slug", "notificationEmail", "deliveryFeeKobo"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 120 },
          slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          notificationEmail: { type: "string", format: "email" },
          deliveryFeeKobo: { type: "integer", minimum: 0 },
        },
      },
      UpdateVendorInput: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string" },
          notificationEmail: { type: "string", format: "email" },
          deliveryFeeKobo: { type: "integer", minimum: 0 },
          isActive: { type: "boolean" },
        },
      },
      CreateCategoryInput: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          sortOrder: { type: "integer", minimum: 0, default: 0 },
        },
      },
      UpdateCategoryInput: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string" },
          sortOrder: { type: "integer", minimum: 0 },
          isActive: { type: "boolean" },
        },
      },
      CreateMenuItemInput: {
        type: "object",
        required: ["name", "priceKobo"],
        properties: {
          name: { type: "string" },
          description: { type: "string", nullable: true },
          priceKobo: { type: "integer", minimum: 1 },
          categoryId: { type: "string", format: "uuid", nullable: true },
          imageUrl: { type: "string", format: "uri", nullable: true },
          isAvailable: { type: "boolean", default: true },
        },
      },
      UpdateMenuItemInput: {
        type: "object",
        minProperties: 1,
        properties: {
          name: { type: "string" },
          description: { type: "string", nullable: true },
          priceKobo: { type: "integer", minimum: 1 },
          categoryId: { type: "string", format: "uuid", nullable: true },
          imageUrl: { type: "string", format: "uri", nullable: true },
          isAvailable: { type: "boolean" },
        },
      },
      AddCartItemInput: {
        type: "object",
        required: ["menuItemId", "quantity"],
        properties: {
          menuItemId: { type: "string", format: "uuid" },
          quantity: { type: "integer", minimum: 1, maximum: 99 },
        },
      },
      UpdateCartItemInput: {
        type: "object",
        required: ["quantity"],
        properties: { quantity: { type: "integer", minimum: 1, maximum: 99 } },
      },
      CheckoutInput: {
        type: "object",
        required: ["vendorId", "deliveryAddress"],
        properties: {
          vendorId: { type: "string", format: "uuid" },
          deliveryAddress: { type: "string", minLength: 5, maxLength: 500 },
          deliveryNote: { type: "string", nullable: true },
          paymentMethod: {
            type: "string",
            enum: ["CASH_ON_DELIVERY"],
            default: "CASH_ON_DELIVERY",
          },
        },
      },
      CheckoutResponse: {
        type: "object",
        properties: {
          order: { $ref: "#/components/schemas/Order" },
          replayed: { type: "boolean" },
        },
      },
      OrderStatus: {
        type: "string",
        enum: [
          "PENDING_VENDOR_CONFIRMATION",
          "CONFIRMED",
          "PREPARING",
          "READY_FOR_DISPATCH",
          "OUT_FOR_DELIVERY",
          "DELIVERED",
          "CANCELLED",
        ],
      },
      UpdateOrderStatusInput: {
        type: "object",
        required: ["status"],
        properties: {
          status: { $ref: "#/components/schemas/OrderStatus" },
          note: { type: "string", nullable: true, maxLength: 500 },
        },
      },
      CancelOrderInput: {
        type: "object",
        properties: {
          note: { type: "string", nullable: true, maxLength: 500 },
        },
      },
    },
  },
} as const;
