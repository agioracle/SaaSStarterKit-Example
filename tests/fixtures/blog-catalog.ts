import { allBlogs, allBlogSummaries } from '../../.content-collections/generated';
/** Pagination contracts use explicit data, independently of the shipped welcome article. */
export function seedBlogPagination() {
  const full = [...allBlogs];
  const summaries = [...allBlogSummaries];
  for (const locale of ['en', 'zh']) {
    const post = full.find(value => value.locale === locale);
    const summary = summaries.find(value => value.locale === locale);
    if (!post || !summary) throw Error('The default welcome translation must be published.');
    for (let index = 0; index < 7; index++) {
      const fields = { slug: `pagination-fixture-${index}`, title: `Pagination fixture ${index}`, date: `2027-01-0${index + 1}`, category: `Fixture category ${index}` };
      allBlogs.push({ ...post, ...fields });
      allBlogSummaries.push({ ...summary, ...fields });
    }
  }
  return () => { allBlogs.splice(0, allBlogs.length, ...full); allBlogSummaries.splice(0, allBlogSummaries.length, ...summaries); };
}
