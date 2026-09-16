"use client";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Eye, EyeOff, Trash2 } from "lucide-react";
import { useRef, type ReactNode } from "react";
import {
  titles,
  fieldLabels,
  blankFields,
  type Section,
  type Item,
  type ResumeData,
} from "@resume/schema";
import {
  ItemView,
  hasContent,
  timelineItems,
} from "@/components/resume/document";
import { RichEditor } from "./rich-editor";
import { api } from "../api";
export function Sortable({
  id,
  children,
  label,
}: {
  id: string;
  children: ReactNode;
  label: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="sortable"
    >
      <button
        ref={setActivatorNodeRef}
        className="drag-handle no-print"
        aria-label={`${label} 순서 변경`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={17} />
      </button>
      {children}
    </div>
  );
}
export function SectionEditor({
  section,
  document,
  active,
  onActivate,
  onChange,
  onError,
}: {
  section: Section;
  document: ResumeData;
  active: boolean;
  onActivate: () => void;
  onChange: (s: Section) => void;
  onError: (e: string) => void;
}) {
  const latestSection = useRef(section);
  latestSection.current = section;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const update = (item: Item, fields: Record<string, any>) =>
    onChange({
      ...section,
      items: section.items.map((i) =>
        i.id === item.id ? { ...i, fields } : i,
      ),
    });
  const content = (item: Item) => (
    <div className={`resume-item ${!item.visible ? "is-hidden" : ""}`}>
      {active ? (
        <>
          <div className="item-controls no-print">
            <code title="GPT 가져오기 대상 ID">{item.id}</code>
            <button
              aria-label={item.visible ? "항목 숨기기" : "항목 표시"}
              onClick={() =>
                onChange({
                  ...section,
                  items: section.items.map((i) =>
                    i.id === item.id ? { ...i, visible: !i.visible } : i,
                  ),
                })
              }
            >
              {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              aria-label="항목 삭제"
              onClick={() =>
                onChange({
                  ...section,
                  items: section.items.filter((i) => i.id !== item.id),
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className={`inline-fields fields-${section.kind}`}>
            {Object.entries(item.fields).map(([field, value]) => {
              if (field === "photo_asset_id")
                return (
                  <div className="photo-edit" key={field}>
                    {value && (
                      <img
                        className="profile-photo"
                        alt="프로필 사진"
                        src={`/api/v1/assets/${value}`}
                      />
                    )}
                    <label>
                      프로필 사진
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const form = new FormData();
                            form.set("file", file);
                            const result = await api("assets", "POST", form);
                            const current = latestSection.current;
                            onChange({
                              ...current,
                              items: current.items.map((entry) =>
                                entry.id === item.id
                                  ? {
                                      ...entry,
                                      fields: {
                                        ...entry.fields,
                                        [field]: result.id,
                                      },
                                    }
                                  : entry,
                              ),
                            });
                          } catch (e) {
                            onError((e as Error).message);
                          }
                        }}
                      />
                    </label>
                    {value && (
                      <button
                        onClick={() =>
                          update(item, { ...item.fields, [field]: null })
                        }
                      >
                        사진 제거
                      </button>
                    )}
                  </div>
                );
              const change = (v: unknown) =>
                update(item, { ...item.fields, [field]: v });
              if (field === "body")
                return (
                  <div className="wide" key={field}>
                    <RichEditor value={value} onChange={change} />
                  </div>
                );
              if (field === "reference_id")
                return (
                  <label key={field}>
                    {fieldLabels[field]}
                    <select
                      value={value}
                      onChange={(e) => change(e.target.value)}
                    >
                      <option value="">독립 연혁</option>
                      {document.sections
                        .filter((s) =>
                          [
                            "projects",
                            "experience",
                            "education",
                            "training",
                          ].includes(s.kind),
                        )
                        .flatMap((s) =>
                          s.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {titles[s.kind]} /{" "}
                              {i.fields.name || "(제목 없음)"}
                            </option>
                          )),
                        )}
                    </select>
                  </label>
                );
              if (
                field === "category" &&
                ["awards", "certification"].includes(section.kind)
              )
                return (
                  <label key={field}>
                    {fieldLabels[field]}
                    <select
                      value={value}
                      onChange={(e) => change(e.target.value)}
                    >
                      {(section.kind === "awards"
                        ? ["수상", "활동"]
                        : ["자격증", "외국어"]
                      ).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                );
              return (
                <label
                  key={field}
                  className={
                    Array.isArray(value) ||
                    [
                      "summary",
                      "reason",
                      "major_courses",
                      "elective_courses",
                    ].includes(field)
                      ? "wide"
                      : ""
                  }
                >
                  {fieldLabels[field] ?? field}
                  {Array.isArray(value) ? (
                    <textarea
                      value={value.join("\n")}
                      onChange={(e) => change(e.target.value.split("\n"))}
                    />
                  ) : [
                      "summary",
                      "reason",
                      "major_courses",
                      "elective_courses",
                    ].includes(field) ? (
                    <textarea
                      value={value}
                      onChange={(e) => change(e.target.value)}
                    />
                  ) : (
                    <input
                      value={value ?? ""}
                      placeholder={fieldLabels[field]}
                      onChange={(e) => change(e.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </>
      ) : hasContent(item) ? (
        <ItemView item={item} kind={section.kind} />
      ) : (
        <p className="placeholder">
          클릭하여 {titles[section.kind]} 내용을 작성하세요.
        </p>
      )}
    </div>
  );
  const displayed = active
    ? section.items
    : section.kind === "timeline"
      ? timelineItems(section, document)
      : section.items.filter((i) => i.visible);
  return (
    <section
      data-edit-section={section.id}
      className={`resume-section section-${section.kind} editable-section ${active ? "editing" : ""} ${!section.visible ? "is-hidden" : ""}`}
      onClick={onActivate}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onActivate();
      }}
    >
      <div className="section-heading">
        <h2>{titles[section.kind]}</h2>
        <button
          className="quiet no-print"
          aria-label={section.visible ? "섹션 숨기기" : "섹션 표시"}
          onClick={(e) => {
            e.stopPropagation();
            onChange({ ...section, visible: !section.visible });
          }}
        >
          {section.visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id)
            onChange({
              ...section,
              items: arrayMove(
                section.items,
                section.items.findIndex((i) => i.id === active.id),
                section.items.findIndex((i) => i.id === over.id),
              ),
            });
        }}
      >
        <SortableContext
          items={section.items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <div
            className={!active && section.kind === "timeline" ? "timeline" : ""}
          >
            {displayed.map((item) =>
              active && section.kind !== "timeline" ? (
                <Sortable id={item.id} label="항목" key={item.id}>
                  {content(item)}
                </Sortable>
              ) : (
                <div key={item.id}>{content(item)}</div>
              ),
            )}
          </div>
        </SortableContext>
      </DndContext>
      {!displayed.length && !active && (
        <p className="placeholder">클릭하여 항목 추가</p>
      )}
      {active &&
        (!["profile", "introduction"].includes(section.kind) ||
          !section.items.length) && (
          <button
            className="add-item no-print"
            onClick={() =>
              onChange({
                ...section,
                items: [
                  ...section.items,
                  {
                    id: crypto.randomUUID(),
                    visible: true,
                    fields: blankFields(section.kind),
                  },
                ],
              })
            }
          >
            <Plus size={15} /> 항목 추가
          </button>
        )}
    </section>
  );
}
