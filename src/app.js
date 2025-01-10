const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

const db = new sqlite3.Database("./tasks.db", (err) => {
  if (err) {
    console.error("Error connecting to database:", err);
  } else {
    console.log("Connected to database");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      done BOOLEAN DEFAULT 0,
      position INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_relationships (
      parent_id INTEGER,
      child_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES tasks (id) ON DELETE CASCADE,
      FOREIGN KEY (child_id) REFERENCES tasks (id) ON DELETE CASCADE,
      PRIMARY KEY (parent_id, child_id)
    )
  `);
});

app.get("/tasks", (req, res) => {
  const query = `
    SELECT t.*, 
           GROUP_CONCAT(DISTINCT pr.child_id) as child_tasks,
           GROUP_CONCAT(DISTINCT cr.parent_id) as parent_tasks
    FROM tasks t
    LEFT JOIN task_relationships pr ON t.id = pr.parent_id
    LEFT JOIN task_relationships cr ON t.id = cr.child_id
    GROUP BY t.id
    ORDER BY t.position
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const tasks = rows.map((task) => ({
      ...task,
      child_tasks: task.child_tasks
        ? task.child_tasks.split(",").map(Number)
        : [],
      parent_tasks: task.parent_tasks
        ? task.parent_tasks.split(",").map(Number)
        : [],
    }));

    res.json(tasks);
  });
});

app.post("/tasks", (req, res) => {
  const { title, description, parentTasks = [], childTasks = [] } = req.body;

  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  db.run(
    "INSERT INTO tasks (title, description, position) SELECT ?, ?, COALESCE(MAX(position) + 1, 0) FROM tasks",
    [title, description],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const taskId = this.lastID;
      const relationships = [
        ...parentTasks.map((parentId) => ({
          parent_id: parentId,
          child_id: taskId,
        })),
        ...childTasks.map((childId) => ({
          parent_id: taskId,
          child_id: childId,
        })),
      ];

      if (relationships.length > 0) {
        const relationshipPlaceholders = relationships
          .map(() => "(?, ?)")
          .join(",");
        const relationshipValues = relationships.flatMap((r) => [
          r.parent_id,
          r.child_id,
        ]);

        db.run(
          `INSERT INTO task_relationships (parent_id, child_id) VALUES ${relationshipPlaceholders}`,
          relationshipValues,
          (err) => {
            if (err) {
              res.status(500).json({ error: err.message });
              return;
            }
            res.json({ id: taskId, title, description });
          }
        );
      } else {
        res.json({ id: taskId, title, description });
      }
    }
  );
});

app.put("/tasks/reorder", (req, res) => {
  const { tasks } = req.body;

  if (!Array.isArray(tasks)) {
    res.status(400).json({ error: "Tasks must be an array" });
    return;
  }

  let errorOccurred = false;

  tasks.forEach((taskId, index) => {
    db.run(
      "UPDATE tasks SET position = ? WHERE id = ?",
      [index, taskId],
      (err) => {
        if (err) {
          errorOccurred = true;
        }
      }
    );
  });

  if (errorOccurred) {
    res.status(500).json({ error: "Error, try again" });
  } else {
    res.json({ message: "Tasks reordered successfully" });
  }
});

app.put("/tasks/:id", (req, res) => {
  const { id } = req.params;
  const { done } = req.body;

  db.run(
    "UPDATE tasks SET done = ? WHERE id = ?",
    [done ? 1 : 0, id],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json({ message: `Status task ${id} berhasil diubah: ${done == 1 ? 'Selesai': 'Belum Selesai'}` });
    }
  );
});

app.delete("/tasks/:id", (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM tasks WHERE id = ?", [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ message: "Task deleted successfully" });
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error!" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
