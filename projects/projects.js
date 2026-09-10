const STORAGE_KEY = "ashley-projects-todos-v1";

const DEFAULT_PROJECTS = [
  {
    id: "roundup",
    name: "Round-Up",
    status: "Building",
    href: "../app/",
    blurb: "Group planning: calendar, plans, voting, then an admin finalises.",
    todos: [
      { id: "ru-1", text: "Keep the mockups on the Round-Up page", done: true },
      { id: "ru-2", text: "Lock the name: Round-Up vs Round-Up Friends", done: false },
      { id: "ru-3", text: "Choose default theme (light / dark / system)", done: false },
      { id: "ru-4", text: "Build sign-in: email, Apple, Google", done: false },
      { id: "ru-5", text: "Calendar with confirmed / suggestion / blocked", done: false },
      { id: "ru-6", text: "Plans list with search and status filters", done: false },
      { id: "ru-7", text: "Plan detail: RSVP plus date and location votes", done: false },
      { id: "ru-8", text: "Groups, members, and admin “finalise plan”", done: false },
    ],
  },
  {
    id: "site",
    name: "This site",
    status: "Active",
    href: "../index.html",
    blurb: "Personal workspace for CV, job notes, and app materials.",
    todos: [
      { id: "st-1", text: "Wire pages to the files already in the folders", done: true },
      { id: "st-2", text: "Keep job exports off any public host", done: false },
      { id: "st-3", text: "Pick a host for the CV and Round-Up pages only", done: false },
      { id: "st-4", text: "Add a real photo or mark if you want a face on the CV", done: false },
    ],
  },
  {
    id: "career",
    name: "Career kit",
    status: "Ready",
    href: "../cv/",
    blurb: "Résumés and letters ready to tailor for the next role.",
    todos: [
      { id: "cr-1", text: "Backend CV and ATS CV are in cv/files", done: true },
      { id: "cr-2", text: "Refresh the cover letter for the next application", done: false },
      { id: "cr-3", text: "Check LinkedIn matches the CV headline", done: false },
    ],
  },
];

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mergeProjects() {
  const saved = loadState();
  return DEFAULT_PROJECTS.map((project) => {
    const extra = saved[project.id] || {};
    const savedTodos = extra.todos || [];
    const savedById = Object.fromEntries(savedTodos.map((t) => [t.id, t]));
    const defaults = project.todos.map((todo) => {
      const override = savedById[todo.id];
      return override ? { ...todo, done: override.done, text: override.text || todo.text } : { ...todo };
    });
    const custom = savedTodos.filter((t) => t.custom);
    return { ...project, todos: [...defaults, ...custom] };
  });
}

function persist(projects) {
  const state = {};
  projects.forEach((project) => {
    state[project.id] = { todos: project.todos };
  });
  saveState(state);
}

let scrolledToHash = false;

function uid() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function render(projects) {
  const root = document.getElementById("project-boards");
  root.replaceChildren();

  projects.forEach((project) => {
    const done = project.todos.filter((t) => t.done).length;
    const total = project.todos.length;

    const article = document.createElement("article");
    article.className = "todo-board";
    article.id = project.id;
    article.innerHTML = `
      <header class="todo-board-head">
        <div>
          <p class="project-type">${project.status}</p>
          <h2>${project.name}</h2>
          <p>${project.blurb}</p>
        </div>
        <div class="todo-progress">
          <span>${done} / ${total}</span>
          <a class="text-link" href="${project.href}">Open <span>→</span></a>
        </div>
      </header>
      <ul class="todo-list"></ul>
      <form class="todo-add">
        <label class="visually-hidden" for="add-${project.id}">Add a todo for ${project.name}</label>
        <input id="add-${project.id}" name="text" type="text" placeholder="Add a todo…" autocomplete="off" />
        <button type="submit" class="button button-primary">Add</button>
      </form>
    `;

    const list = article.querySelector(".todo-list");
    project.todos.forEach((todo) => {
      const li = document.createElement("li");
      li.className = todo.done ? "todo-item is-done" : "todo-item";

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = todo.done;
      const text = document.createElement("span");
      text.textContent = todo.text;
      label.append(checkbox, text);
      li.append(label);

      checkbox.addEventListener("change", (event) => {
        todo.done = event.target.checked;
        persist(projects);
        render(projects);
      });

      if (todo.custom) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "todo-remove";
        remove.setAttribute("aria-label", `Remove ${todo.text}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          project.todos = project.todos.filter((t) => t.id !== todo.id);
          persist(projects);
          render(projects);
        });
        li.append(remove);
      }

      list.append(li);
    });

    article.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = event.currentTarget.querySelector("input");
      const text = input.value.trim();
      if (!text) return;
      project.todos.push({ id: uid(), text, done: false, custom: true });
      persist(projects);
      render(projects);
    });

    root.append(article);
  });

  const hash = location.hash.slice(1);
  if (!scrolledToHash && hash) {
    scrolledToHash = true;
    const target = document.getElementById(hash);
    if (target) target.scrollIntoView({ block: "start" });
  }
}

render(mergeProjects());
