import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { localePath } from "../../locale";
import { AbstractArt } from "./art";
import { l, promptText } from "./copy";

export function LandingPage() {
	const [study, setStudy] = useState(0);
	const variants = ["arch", "orbit", "bloom"] as const;
	return (
		<div className="lm-landing">
			<section className="lm-home-intro container">
				<h1>{l("home_title")}</h1>
				<div>
					<p>{l("home_intro")}</p>
					<a
						className="button primary"
						href={`${localePath("/studio")}?idea=${study}`}
					>
						{l("start_creating")}
						<ArrowUpRight size={18} />
					</a>
				</div>
			</section>
			<section
				className="lm-proof-demo container"
				aria-label={l("home_recipe")}
			>
				<div className="lm-demo-recipe">
					<div className="lm-demo-heading">
						<h2>{l("home_recipe")}</h2>
						<LockKeyhole size={18} aria-hidden="true" />
					</div>
					<p className="lm-demo-prompt">{promptText(study)}</p>
					<fieldset
						className="lm-demo-choices"
						aria-label={l("creative_direction")}
					>
						{variants.map((variant, index) => (
							<button
								key={variant}
								type="button"
								aria-pressed={study === index}
								onClick={() => setStudy(index)}
							>
								<AbstractArt variant={variant} />
								<span>
									{
										[
											l("start_with_your_words"),
											l("objects_of_curiosity"),
											l("a_softer_kind_of_world"),
										][index]
									}
								</span>
							</button>
						))}
					</fieldset>
					<dl className="lm-demo-facts">
						<div>
							<dt>{l("aspect_ratio")}</dt>
							<dd>1:1</dd>
						</div>
						<div>
							<dt>{l("private_to_your_account")}</dt>
							<dd>
								<Check size={16} />
							</dd>
						</div>
					</dl>
					<a
						className="lm-text-link"
						href={`${localePath("/studio")}?idea=${study}`}
					>
						{l("home_try")}
						<ArrowRight size={18} />
					</a>
				</div>
				<figure className="lm-demo-proof">
					<AbstractArt variant={variants[study]} />
					<figcaption>{l("home_sample")}</figcaption>
				</figure>
			</section>
			<div className="lm-home-providers container">
				<span>fal.ai</span>
				<span>Cloudflare Workers AI</span>
				<p>{l("home_models")}</p>
			</div>
			<section className="lm-home-process container" id="how-it-works">
				<div>
					<h2>{l("home_process")}</h2>
					<p>{l("home_process_intro")}</p>
				</div>
				<ol>
					<li>
						<h3>{l("describe_it")}</h3>
						<p>
							{l(
								"write_a_prompt_and_select_your_model_start_with_a_preset_if_the_blank_",
							)}
						</p>
					</li>
					<li>
						<h3>{l("make_space_for_it")}</h3>
						<p>
							{l(
								"follow_the_real_job_status_without_invented_progress_bars_your_request",
							)}
						</p>
					</li>
					<li>
						<h3>{l("make_it_yours")}</h3>
						<p>
							{l(
								"download_the_finished_image_or_reuse_its_prompt_for_a_fresh_direction_",
							)}
						</p>
					</li>
				</ol>
			</section>
			<section className="lm-home-keeping" id="features">
				<div className="container lm-keeping-grid">
					<div>
						<h2>{l("home_private")}</h2>
						<p>{l("home_private_text")}</p>
						<a href={localePath("/library")} className="button secondary">
							{l("my_library")}
							<ArrowUpRight size={16} />
						</a>
					</div>
					<div className="lm-honest-state">
						<h2>{l("home_honest")}</h2>
						<p>{l("home_honest_text")}</p>
						<div className="lm-state-samples">
							<span>{l("in_the_queue")}</span>
							<span>{l("ready")}</span>
							<span>{l("needs_a_status_check")}</span>
						</div>
					</div>
				</div>
			</section>
			<section className="lm-home-close container">
				<h2>{l("home_close")}</h2>
				<a href={localePath("/studio")} className="button primary">
					{l("start_creating")}
					<ArrowUpRight size={18} />
				</a>
			</section>
		</div>
	);
}
