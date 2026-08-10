export const seedData = {
  users: [
    {
      email: "customer@chowchow.local",
      fullName: "Demo Customer",
      role: "CUSTOMER",
    },
    {
      email: "admin@chowchow.local",
      fullName: "Demo Admin",
      role: "ADMIN",
    },
    {
      email: "vendor.one@chowchow.local",
      fullName: "Demo Vendor One",
      role: "VENDOR",
    },
    {
      email: "vendor.two@chowchow.local",
      fullName: "Demo Vendor Two",
      role: "VENDOR",
    },
  ] as const,
  vendors: [
    {
      slug: "lagos-bites",
      name: "Lagos Bites",
      notificationEmail: "vendor.one@chowchow.local",
      deliveryFeeKobo: 100_000,
    },
    {
      slug: "island-kitchen",
      name: "Island Kitchen",
      notificationEmail: "vendor.two@chowchow.local",
      deliveryFeeKobo: 150_000,
    },
  ] as const,
  memberships: [
    { userEmail: "vendor.one@chowchow.local", vendorSlug: "lagos-bites", role: "OWNER" },
    { userEmail: "vendor.two@chowchow.local", vendorSlug: "island-kitchen", role: "OWNER" },
  ] as const,
  categories: [
    { vendorSlug: "lagos-bites", name: "Rice Bowls", sortOrder: 1 },
    { vendorSlug: "lagos-bites", name: "Small Chops", sortOrder: 2 },
    { vendorSlug: "island-kitchen", name: "Grills", sortOrder: 1 },
    { vendorSlug: "island-kitchen", name: "Drinks", sortOrder: 2 },
  ] as const,
  menuItems: [
    { vendorSlug: "lagos-bites", categoryName: "Rice Bowls", name: "Jollof Rice Bowl", description: "Smoky party-style jollof rice with chicken.", priceKobo: 350_000 },
    { vendorSlug: "lagos-bites", categoryName: "Rice Bowls", name: "Fried Rice Bowl", description: "Vegetable fried rice with grilled chicken.", priceKobo: 400_000 },
    { vendorSlug: "lagos-bites", categoryName: "Small Chops", name: "Small Chops Box", description: "Puff puff, spring rolls, samosa, and chicken.", priceKobo: 275_000 },
    { vendorSlug: "lagos-bites", categoryName: "Small Chops", name: "Peppered Wings", description: "Crispy wings tossed in pepper sauce.", priceKobo: 450_000 },
    { vendorSlug: "island-kitchen", categoryName: "Grills", name: "Suya Platter", description: "Beef suya with onions and pepper.", priceKobo: 550_000 },
    { vendorSlug: "island-kitchen", categoryName: "Grills", name: "Chicken Shawarma", description: "Grilled chicken, vegetables, and garlic sauce.", priceKobo: 500_000 },
    { vendorSlug: "island-kitchen", categoryName: "Drinks", name: "Zobo Cooler", description: "Chilled hibiscus drink with pineapple.", priceKobo: 100_000 },
    { vendorSlug: "island-kitchen", categoryName: "Drinks", name: "Ginger Lemonade", description: "Fresh ginger and lemon drink.", priceKobo: 150_000 },
  ] as const,
} as const;
