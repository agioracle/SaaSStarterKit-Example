import { afterEach, describe, it, expect, vi } from "vitest";
import { allBlogs } from "../.content-collections/generated";
import { getPostBySlug } from "../src/lib/blog";
import { Route } from "../src/routes/blog.$slug";
import { overwriteGetLocale } from "../src/locale/paraglide/runtime";
import { websiteConfig } from "../src/config/website";
import { seo, twitterSiteFromUrl } from "../src/lib/seo";
vi.mock('../src/lib/content-functions', async () => {
  const { queryBlogArticle } = await import('../src/lib/content-queries.server');
  return { getBlogArticle: async ({ data }: { data: { slug: string; locale: import('../src/locale').Locale } }) => queryBlogArticle(data.slug, data.locale) };
});
const length = allBlogs.length;
const previousX = websiteConfig.social.x;
afterEach(() => {
	allBlogs.splice(length);
	overwriteGetLocale(() => "en");
	Object.assign(websiteConfig.social, { x: previousX });
});
describe("documented metadata and translation fallback", () => {
	it("returns the base translation while the route redirects to its actual language", async () => {
		const base = allBlogs.find((post) => post.locale === "en");
		expect(base).toBeTruthy();
		if (!base) throw Error("fixture post required");
		allBlogs.push({ ...base, slug: "base-only-test-post", published: true });
		expect(getPostBySlug("base-only-test-post", "zh")?.locale).toBe("en");
		overwriteGetLocale(() => "zh");
		const loader = Route.options.loader as unknown as (input: {
			params: { slug: string };
		}) => unknown;
		await expect(loader({ params: { slug: "base-only-test-post" } })).rejects.toMatchObject({
      options: { href: "/blog/base-only-test-post" },
    });
		expect(getPostBySlug("absent-test-post", "zh")).toBeUndefined();
	});
	it.each(["https://x.com/valid_handle", "https://twitter.com/valid_handle/"])(
		"maps configured profile %s to twitter:site",
		(url) => {
			Object.assign(websiteConfig.social, { x: url });
			expect(twitterSiteFromUrl(url)).toBe("@valid_handle");
			expect(seo("/", {}).meta).toContainEqual({
				name: "twitter:site",
				content: "@valid_handle",
			});
		},
	);
	it.each([
		"",
		"https://evil.test/name",
		"http://x.com/name",
		"https://x.com/name/status/1",
		"https://name:pass@x.com/name",
		"https://x.com/home",
		"javascript:alert(1)",
		"https://x.com/this_handle_is_too_long",
	])("omits invalid or non-profile URL %s", (url) => {
		expect(twitterSiteFromUrl(url)).toBeUndefined();
	});
});
