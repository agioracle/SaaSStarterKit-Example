import type { BlogSummary } from '../../lib/content-types';
import { BlogCard } from './blog-card';

/** Customize grid layout here without replacing the route's data/SEO boundary. */
export function BlogGrid({ posts }: { posts: BlogSummary[] }) {
  return <div className="blog-grid">{posts.map((post, index) => <BlogCard key={post.slug} post={post} index={index} />)}</div>;
}
