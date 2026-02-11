const posts = [
  {
    slug: "launch",
    title: "A team of agents (PM, Eng, QA) tackles my Linear tickets while I'm driving",
    description:
      "How splitting one AI agent into three specialized roles — a PM, an engineer, and a QA tester — made my productivity go through the roof.",
    date: "2025-06-10",
    location: "San Francisco, CA",
  },
];

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogIndex() {
  return (
    <div className="max-w-2xl mx-auto px-8">
      <div className="mb-14">
        <h1 className="text-[clamp(2rem,5vw,3rem)] font-extrabold tracking-tight mb-3">
          Blog
        </h1>
        <p className="text-muted-foreground text-lg">
          Updates, guides, and stories from the Agent Army team.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {posts.map((post) => (
          <a
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group block rounded-xl border border-border bg-card/30 p-7 transition-all duration-200 hover:bg-card/60 hover:border-primary/30"
          >
            <h2 className="text-lg font-bold text-foreground mb-3 group-hover:text-primary transition-colors">
              {post.title}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              {post.description}
            </p>
            <p className="text-xs text-muted-foreground/70">
              {post.location} &mdash; {formatDate(post.date)}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}
