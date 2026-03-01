import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://clawup.sh",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://docs.clawup.sh",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: "https://docs.clawup.sh/quickstart",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: "https://docs.clawup.sh/prerequisites",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://docs.clawup.sh/cli/overview",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://docs.clawup.sh/architecture/overview",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: "https://docs.clawup.sh/guides/creating-identities",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: "https://docs.clawup.sh/guides/plugins",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: "https://docs.clawup.sh/guides/hooks",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];
}
