import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function dedent(s, n) {
  return s
    .split("\n")
    .map((line) => (line.length >= n ? line.slice(n) : line))
    .join("\n");
}

const flow = dedent(fs.readFileSync(path.join(__dirname, "flow-snippet.txt"), "utf8"), 4);
const email = dedent(fs.readFileSync(path.join(__dirname, "email-snippet.txt"), "utf8"), 4);

const part1 = `  return (
    <div className="flex h-screen bg-[#f6f5f3] text-neutral-900">
      <aside className="flex min-h-0 w-[310px] shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="shrink-0 border-b border-neutral-200 px-3 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMemberPanelOpen((prev) => !prev)}
              className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium"
            >
              Show Members
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium"
            >
              로그아웃
            </button>
          </div>
        </div>

        {memberPanelOpen ? (
          <div className="max-h-[min(40vh,20rem)] shrink-0 overflow-y-auto border-b border-neutral-200 bg-[#f8f7f5] px-2 py-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="text-xs font-semibold">Members</div>
              <div className="text-[10px] text-neutral-500">{globalMembers.length}명</div>
            </div>
            <div className="space-y-2">
              {globalMembers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-200 bg-white px-3 py-4 text-center text-xs text-neutral-400">
                  등록된 멤버가 없습니다.
                </div>
              ) : (
                globalMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-2 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <MemberInitial name={member.name} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="truncate text-xs font-semibold">{member.name}</span>
                          {member.userId &&
                          authUserId &&
                          member.userId === authUserId &&
                          (!authUserEmail?.trim() ||
                            member.email.trim().toLowerCase() === authUserEmail.trim().toLowerCase()) ? (
                            <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-800">
                              나
                            </span>
                          ) : null}
                          {isMemberOnline(member.lastSeenAt) ? (
                            <span className="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-800">
                              접속
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-[10px] text-neutral-500">{member.email}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeGlobalMember(member.id)}
                      disabled={
                        !canDeleteMembers || Boolean(authUserId && member.userId && member.userId === authUserId)
                      }
                      className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="shrink-0 border-b border-neutral-200 p-3">
          <div className="grid grid-cols-[1fr_88px] overflow-hidden rounded-2xl border border-neutral-200">
            <div className="flex items-center justify-center border-r border-neutral-200 bg-white px-4 py-8">
              <div className="text-[20px] font-black tracking-[-0.04em]">PROJECT</div>
            </div>

            <div className="flex flex-col bg-white">
              <button
                type="button"
                onClick={createNewProjectFlow}
                className="border-b border-neutral-200 px-3 py-3 text-left text-sm font-semibold"
              >
                NEW
              </button>

              <div className="border-b border-neutral-200 px-3 py-3 text-left text-sm font-semibold">SEARCH</div>

              <button
                type="button"
                onClick={() => setFilterBarVisible((prev) => !prev)}
                className="border-b border-neutral-200 px-3 py-3 text-left text-sm font-semibold"
              >
                FILTER
              </button>

              <button
                type="button"
                onClick={() => setBoardWideColumns((prev) => !prev)}
                className="px-3 py-3 text-left text-sm font-semibold text-red-500"
              >
                &gt;&gt;
              </button>
            </div>
          </div>

          <div className="mt-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none"
            />
          </div>

          {filterBarVisible ? (
            <div className="mt-3 rounded-2xl border border-neutral-200 bg-[#faf9f7] p-3">{projectFilterPanel}</div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-3">
            {filteredProjects.map((project) => {
              const isSelected = project.id === selectedId;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(project.id);
                    setProjectDetailOpen(true);
                  }}
                  className={[
                    "w-full rounded-2xl border px-4 py-5 text-center transition",
                    isSelected
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-red-500 hover:bg-neutral-50",
                  ].join(" ")}
                >
                  <div className="text-[16px] font-bold tracking-[-0.03em]">
                    {project.code?.trim() || "(NO CODE)"}
                  </div>
                </button>
              );
            })}

            {filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">
                검색 또는 필터 결과가 없습니다.
              </div>
            ) : null}
          </div>
        </div>

        <OptionManageModal
          open={optionManageField !== null}
          field={optionManageField}
          title={
            optionManageField === "items"
              ? "ITEM"
              : optionManageField === "countries"
                ? "COUNTRY"
                : optionManageField === "businessModels"
                  ? "BUSINESS MODEL"
                  : optionManageField === "incoterms"
                    ? "INCOTERMS"
                    : optionManageField === "exporters"
                      ? "EXPORTER"
                      : optionManageField === "clients"
                        ? "CLIENT"
                        : ""
          }
          options={selectOptions}
          projects={projects}
          onClose={() => setOptionManageField(null)}
          onRemoveOption={(field, value) => {
            removeOption(field, value);
          }}
        />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto p-6">
          {boardGroups.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-dashed border-neutral-200 bg-white px-6 py-12 text-center text-sm text-neutral-500">
              {projects.length === 0 ? (
                <div>
                  <div className="text-base font-semibold text-neutral-800">프로젝트가 없습니다.</div>
                  <div className="mt-2 text-xs text-neutral-500">왼쪽에서 NEW로 추가하세요.</div>
                </div>
              ) : (
                <span>조건에 맞는 프로젝트가 없습니다. 필터·검색을 조정해 보세요.</span>
              )}
            </div>
          ) : (
            <div className="flex min-w-max gap-6">
              {boardGroups.map(([itemName, list]) => (
                <section key={itemName} className={boardWideColumns ? "w-[320px] shrink-0" : "w-[280px] shrink-0"}>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="rounded-full bg-[#dbe9df] px-3 py-1 text-sm font-semibold text-neutral-800">
                      {itemName}
                    </span>
                    <span className="text-sm text-neutral-500">{list.length}</span>
                  </div>

                  <div className="space-y-3">
                    {list.map((project) => {
                      const isSelected = project.id === selectedId;

                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(project.id);
                            setProjectDetailOpen(true);
                          }}
                          className={[
                            "w-full rounded-[24px] border p-4 text-left shadow-sm transition",
                            isSelected
                              ? "border-neutral-900 bg-[#eef3ef]"
                              : "border-neutral-200 bg-[#dfe8e3] hover:translate-y-[-1px]",
                          ].join(" ")}
                        >
                          <div className="mb-3 text-[18px] font-bold tracking-[-0.03em]">
                            {project.code?.trim() || "(NO CODE)"}
                          </div>

                          <div className="mb-2 flex flex-wrap gap-2">
                            {project.country?.trim() ? (
                              <span className="rounded-md bg-white/50 px-2 py-1 text-xs font-medium text-neutral-700">
                                {project.country}
                              </span>
                            ) : null}

                            {project.exporter?.trim() ? (
                              <span className="rounded-md bg-white/50 px-2 py-1 text-xs font-medium text-neutral-700">
                                {project.exporter}
                              </span>
                            ) : null}
                          </div>

                          <div className="min-h-[48px] text-sm leading-6 text-neutral-700">
                            {project.note?.trim() || ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {projectDetailOpen && selectedProject ? (
          <aside className="flex min-h-0 w-[380px] shrink-0 flex-col border-l border-neutral-200 bg-white">
            <div className="shrink-0 border-b border-neutral-200 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">Selected Project</div>
                  <div className="mt-1 text-[26px] font-black tracking-[-0.05em]">
                    {selectedProject.code?.trim() || "(NO CODE)"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProjectDetailOpen(false)}
                  className="shrink-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold " + badgeStyle(selectedProject.status)
                  }
                >
                  {selectedProject.status}
                </span>
                <span
                  className={"rounded-md px-2 py-0.5 text-[10px] font-semibold " + itemPillStyle(selectedProject.item)}
                >
                  {selectedProject.item ?? "-"}
                </span>
                <span className="text-[10px] text-neutral-500">
                  {selectedProgress.percent}% · {selectedProject.lastChangedAt}
                </span>
              </div>

              {headerDraft && selectedProject ? (
                <div className="mb-4 grid gap-2 sm:grid-cols-2">
                  <Field label="CODE">
                    <Input
                      value={headerDraft.code}
                      onChange={(v) => updateProjectField(selectedProject.id, "code", v)}
                      placeholder="CODE"
                    />
                  </Field>
                  <Field label="STATUS">
                    <Select
                      value={headerDraft.status}
                      onChange={(v) => updateProjectField(selectedProject.id, "status", v as ProjectStatus)}
                      options={["REVIEW", "IN PROGRESS", "HOLD", "DONE", "DRAFT"]}
                    />
                  </Field>
                  <Field label="ITEM">
                    <CreatableSelect
                      value={headerDraft.item}
                      options={selectOptions.items}
                      onChange={(v) => updateProjectField(selectedProject.id, "item", v)}
                      onCreate={(raw) => handleCreatableCreate("items", "item", raw)}
                      onOpenManage={() => setOptionManageField("items")}
                      placeholder="ITEM"
                    />
                  </Field>
                  <Field label="COUNTRY">
                    <CreatableSelect
                      value={headerDraft.country}
                      options={selectOptions.countries}
                      onChange={(v) => updateProjectField(selectedProject.id, "country", v)}
                      onCreate={(raw) => handleCreatableCreate("countries", "country", raw)}
                      onOpenManage={() => setOptionManageField("countries")}
                      placeholder="COUNTRY"
                    />
                  </Field>
                  <Field label="BUSINESS MODEL">
                    <CreatableSelect
                      value={headerDraft.businessModel}
                      options={selectOptions.businessModels}
                      onChange={(v) => updateProjectField(selectedProject.id, "businessModel", v)}
                      onCreate={(raw) => handleCreatableCreate("businessModels", "businessModel", raw)}
                      onOpenManage={() => setOptionManageField("businessModels")}
                      placeholder="BUSINESS MODEL"
                    />
                  </Field>
                  <Field label="INCOTERMS">
                    <CreatableSelect
                      value={headerDraft.incoterms}
                      options={selectOptions.incoterms}
                      onChange={(v) => updateProjectField(selectedProject.id, "incoterms", v)}
                      onCreate={(raw) => handleCreatableCreate("incoterms", "incoterms", raw)}
                      onOpenManage={() => setOptionManageField("incoterms")}
                      placeholder="INCOTERMS"
                    />
                  </Field>
                  <Field label="EXPORTER">
                    <CreatableSelect
                      value={headerDraft.exporter}
                      options={selectOptions.exporters}
                      onChange={(v) => updateProjectField(selectedProject.id, "exporter", v)}
                      onCreate={(raw) => handleCreatableCreate("exporters", "exporter", raw)}
                      onOpenManage={() => setOptionManageField("exporters")}
                      placeholder="EXPORTER"
                    />
                  </Field>
                  <Field label="CLIENT">
                    <CreatableSelect
                      value={headerDraft.client}
                      options={selectOptions.clients}
                      onChange={(v) => updateProjectField(selectedProject.id, "client", v)}
                      onCreate={(raw) => handleCreatableCreate("clients", "client", raw)}
                      onOpenManage={() => setOptionManageField("clients")}
                      placeholder="CLIENT"
                    />
                  </Field>
                  <details className="sm:col-span-2 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/80 px-3 py-2">
                    <summary className="cursor-pointer list-none text-[11px] font-medium text-neutral-500 marker:hidden [&::-webkit-details-marker]:hidden">
                      <span className="underline decoration-neutral-300 decoration-dotted underline-offset-2">
                        NOTE (선택 · 플로우 메모)
                      </span>
                    </summary>
                    <div className="mt-2 border-t border-neutral-200/80 pt-2">
                      <TextArea
                        value={selectedProject.note}
                        onChange={(v) =>
                          setProjects((prev) =>
                            prev.map((p) =>
                              p.id === selectedProject.id ? { ...p, note: v, updated: true } : p
                            )
                          )
                        }
                        placeholder="필요할 때만 입력"
                        rows={2}
                      />
                    </div>
                  </details>
                </div>
              ) : null}

`;

const part4 = `
            </div>

            <div className="shrink-0 border-t border-neutral-200 px-5 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveHeaderDraft}
                  className="flex-1 rounded-xl bg-[#07153a] px-4 py-3 text-sm font-semibold text-white"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedProject}
                  className="rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </main>
    </div>
  );`;

const out = part1 + "\n" + flow + "\n" + email + part4;
fs.writeFileSync(path.join(__dirname, "new-page-return.txt"), out, "utf8");
console.log("wrote new-page-return.txt", out.length);
