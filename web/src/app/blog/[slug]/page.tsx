import { notFound } from "next/navigation";
import LaunchPost from "./posts/launch";

const posts: Record<string, {
  title: string;
  date: string;
  location: string;
  author: string;
  authorUrl: string;
  content: React.ComponentType;
}> = {
  launch: {
    title: "A team of agents (PM, Eng, QA) tackles my Linear tickets while I\u2019m driving",
    date: "June 10, 2025",
    location: "San Francisco, CA",
    author: "Stepan",
    authorUrl: "https://x.com/stepanarsent",
    content: LaunchPost,
  },
};

export function generateStaticParams() {
  return Object.keys(posts).map((slug) => ({ slug }));
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts[slug];
  if (!post) notFound();

  const Content = post.content;

  return (
    <article className="max-w-2xl mx-auto px-8">
      {/* Header */}
      <header className="mb-12">
        <h1 className="text-[clamp(1.8rem,4vw,2.5rem)] font-extrabold tracking-tight leading-tight mb-5">
          {post.title}
        </h1>
        <p className="text-sm text-muted-foreground/70 mb-5">
          {post.location} &mdash; {post.date}
        </p>
        <div className="h-px bg-border" />
      </header>

      {/* Body */}
      <Content />

      {/* Author sign-off */}
      <p className="mt-10 text-base text-muted-foreground">
        &mdash;{" "}
        <a
          href={post.authorUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground font-medium hover:text-primary transition-colors"
        >
          {post.author}
        </a>
      </p>

      {/* Back link */}
      <div className="mt-14 pt-8 border-t border-border">
        <a
          href="/blog"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to blog
        </a>
      </div>
    </article>
  );
}
