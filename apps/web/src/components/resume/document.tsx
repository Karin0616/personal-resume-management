import type { ReactNode } from "react";
import { Pagination } from "./pagination";
import {
  titles,
  type ResumeData,
  type Section,
  type Item,
  type RichNode,
} from "@resume/schema";
export function Rich({ node }: { node: RichNode }) {
  if (node.type === "text") {
    let text: ReactNode = node.text;
    for (const m of node.marks ?? []) {
      if (m.type === "bold") text = <strong>{text}</strong>;
      if (m.type === "italic") text = <em>{text}</em>;
      if (m.type === "strike") text = <s>{text}</s>;
      if (m.type === "code") text = <code>{text}</code>;
      if (
        m.type === "link" &&
        m.attrs?.href &&
        /^https?:\/\//.test(m.attrs.href)
      )
        text = (
          <a href={m.attrs.href} rel="noopener noreferrer">
            {text}
          </a>
        );
    }
    return <>{text}</>;
  }
  const children = node.content?.map((n, i) => <Rich key={i} node={n} />);
  if (node.type === "paragraph") return <p>{children}</p>;
  if (node.type === "bulletList") return <ul>{children}</ul>;
  if (node.type === "orderedList") return <ol>{children}</ol>;
  if (node.type === "listItem") return <li>{children}</li>;
  if (node.type === "hardBreak") return <br />;
  return <>{children}</>;
}
export function hasContent(item: Item) {
  return Object.entries(item.fields).some(
    ([k, v]) =>
      !["category", "reference_id"].includes(k) &&
      v !== null &&
      v !== "" &&
      (Array.isArray(v)
        ? v.length > 0
        : typeof v === "object"
          ? JSON.stringify(v).includes('"text"')
          : true),
  );
}
export function ItemView({
  item,
  kind,
  assetBase = "/api/v1/assets",
}: {
  item: Item;
  kind: Section["kind"];
  assetBase?: string;
}) {
  const f = item.fields;
  if (kind === "profile")
    return (
      <div className="profile-layout">
        <div>
          <h1>{f.name}</h1>
          <p className="profile-role">{f.role}</p>
          <div className="contact">
            {[f.phone, f.email].filter(Boolean).map((s: string) => (
              <span key={s}>{s}</span>
            ))}
            {[
              ["GitHub", f.github],
              ["Blog", f.blog],
            ]
              .filter(([, url]) => url)
              .map(([label, url]) => (
                <a key={label} href={url} rel="noopener noreferrer">
                  {label} ↗
                </a>
              ))}
          </div>
        </div>
        {f.photo_asset_id && (
          <img
            alt="프로필 사진"
            className="profile-photo"
            src={`${assetBase}/${f.photo_asset_id}`}
          />
        )}
      </div>
    );
  if (kind === "introduction") return <Rich node={f.body} />;
  if (kind === "skills")
    return (
      <div className="skills-row">
        <strong>{f.category}</strong>
        <div>
          {f.tools.map((t: string, i: number) => (
            <span className="skill" key={i}>
              {t}
            </span>
          ))}
        </div>
      </div>
    );
  return (
    <div>
      <div className="item-heading">
        <h3>{f.name}</h3>
        <span className="period">
          {f.start}
          {f.end ? ` — ${f.end}` : ""}
        </span>
      </div>
      {f.category && <span className="item-category">{f.category}</span>}
      {f.summary && <p>{f.summary}</p>}
      {(f.role || f.team_size) && (
        <p className="muted">
          {[f.role, f.team_size && `팀 규모 ${f.team_size}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {f.abstracts?.length > 0 && (
        <ul>
          {f.abstracts.map((s: string, i: number) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {f.body && <Rich node={f.body} />}{" "}
      {f.links?.map((url: string, i: number) => (
        <a
          className="document-link"
          href={url}
          key={i}
          rel="noopener noreferrer"
        >
          {url}
        </a>
      ))}
      {f.major_courses && (
        <p>
          <strong>전공</strong> · {f.major_courses}
        </p>
      )}
      {f.elective_courses && (
        <p>
          <strong>교양</strong> · {f.elective_courses}
        </p>
      )}
      {f.reason && <p>{f.reason}</p>}
      {(f.issuer || f.level) && (
        <p>{[f.issuer, f.level].filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}
export function timelineItems(section: Section, document: ResumeData) {
  return section.items
    .filter((i) => i.visible)
    .flatMap((item) => {
      if (!item.fields.reference_id) return [item];
      const source = document.sections
        .filter(
          (s) =>
            s.visible &&
            ["projects", "experience", "education", "training"].includes(
              s.kind,
            ),
        )
        .flatMap((s) => s.items)
        .find((i) => i.id === item.fields.reference_id && i.visible);
      return source
        ? [
            {
              ...item,
              fields: {
                ...item.fields,
                name: source.fields.name,
                start: source.fields.start,
                end: source.fields.end,
              },
            },
          ]
        : [];
    })
    .sort((a, b) =>
      (b.fields.end === "현재"
        ? "9999"
        : b.fields.end || b.fields.start
      ).localeCompare(
        a.fields.end === "현재" ? "9999" : a.fields.end || a.fields.start,
      ),
    );
}
export function ResumeDocument({
  document,
  assetBase,
}: {
  document: ResumeData;
  assetBase?: string;
}) {
  return (
    <article className="resume-paper">
      <Pagination />
      {document.sections
        .filter((s) => s.visible)
        .map((s) => {
          const items = (
            s.kind === "timeline"
              ? timelineItems(s, document)
              : s.items.filter((i) => i.visible)
          ).filter(hasContent);
          if (!items.length) return null;
          return (
            <section className={`resume-section section-${s.kind}`} key={s.id}>
              {s.kind !== "profile" && <h2>{titles[s.kind]}</h2>}
              <div className={s.kind === "timeline" ? "timeline" : ""}>
                {items.map((item) => (
                  <div className="resume-item" key={item.id}>
                    <ItemView item={item} kind={s.kind} assetBase={assetBase} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
    </article>
  );
}
