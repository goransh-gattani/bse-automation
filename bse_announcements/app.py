"""Tkinter UI: enter a scrip code, fetch filings, open their PDFs."""

import json
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import messagebox, ttk

from .api import DEFAULT_PARAMS, BseApiError, fetch_announcements

SETTINGS_FILE = Path.home() / ".bse_automation.json"

PARAM_LABELS = [
    ("pageno", "Page no"),
    ("strCat", "Category (strCat)"),
    ("subcategory", "Subcategory"),
    ("strPrevDate", "From date (YYYYMMDD)"),
    ("strToDate", "To date (YYYYMMDD)"),
    ("strSearch", "strSearch"),
    ("strType", "strType"),
]

COLUMNS = [
    ("date", "Date", 150),
    ("company", "Company", 180),
    ("headline", "Headline", 420),
    ("category", "Category", 130),
    ("pdf", "PDF", 70),
]


def load_settings():
    settings = {"scrip": "532942", "params": dict(DEFAULT_PARAMS)}
    try:
        saved = json.loads(SETTINGS_FILE.read_text())
        settings["scrip"] = saved.get("scrip", settings["scrip"])
        settings["params"].update(saved.get("params", {}))
    except (OSError, ValueError):
        pass
    return settings


def save_settings(scrip, params):
    try:
        SETTINGS_FILE.write_text(json.dumps({"scrip": scrip, "params": params}, indent=2))
    except OSError:
        pass


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("BSE Announcements")
        self.geometry("1050x600")
        self.minsize(800, 400)

        settings = load_settings()
        self.scrip_var = tk.StringVar(value=settings["scrip"])
        self.param_vars = {
            key: tk.StringVar(value=settings["params"].get(key, DEFAULT_PARAMS[key]))
            for key, _ in PARAM_LABELS
        }
        self.status_var = tk.StringVar(value="Enter a scrip code and press Fetch.")
        self.pdf_urls = {}

        self._build_ui()

    def _build_ui(self):
        top = ttk.Frame(self, padding=10)
        top.pack(fill="x")

        ttk.Label(top, text="Scrip code:").grid(row=0, column=0, sticky="w")
        scrip_entry = ttk.Entry(top, textvariable=self.scrip_var, width=14, font=("TkDefaultFont", 12))
        scrip_entry.grid(row=0, column=1, sticky="w", padx=(4, 12))
        scrip_entry.bind("<Return>", lambda e: self.fetch())
        scrip_entry.focus_set()

        self.fetch_btn = ttk.Button(top, text="Fetch", command=self.fetch)
        self.fetch_btn.grid(row=0, column=2, padx=4)
        ttk.Button(top, text="◀ Prev page", command=lambda: self._change_page(-1)).grid(row=0, column=3, padx=4)
        ttk.Button(top, text="Next page ▶", command=lambda: self._change_page(1)).grid(row=0, column=4, padx=4)
        ttk.Button(top, text="Reset params", command=self._reset_params).grid(row=0, column=5, padx=4)

        params = ttk.LabelFrame(self, text="Parameters", padding=8)
        params.pack(fill="x", padx=10)
        for i, (key, label) in enumerate(PARAM_LABELS):
            r, c = divmod(i, 4)
            ttk.Label(params, text=label + ":").grid(row=r, column=c * 2, sticky="e", padx=(8, 2), pady=2)
            ttk.Entry(params, textvariable=self.param_vars[key], width=18).grid(
                row=r, column=c * 2 + 1, sticky="w", pady=2
            )

        table = ttk.Frame(self, padding=(10, 8))
        table.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(table, columns=[c[0] for c in COLUMNS], show="headings", selectmode="browse")
        for key, heading, width in COLUMNS:
            self.tree.heading(key, text=heading)
            self.tree.column(key, width=width, anchor="center" if key == "pdf" else "w", stretch=key == "headline")
        vsb = ttk.Scrollbar(table, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self.tree.tag_configure("nopdf", foreground="gray")
        self.tree.bind("<ButtonRelease-1>", self._on_click)
        self.tree.bind("<Double-1>", lambda e: self.open_selected_pdf())

        bottom = ttk.Frame(self, padding=(10, 0, 10, 10))
        bottom.pack(fill="x")
        ttk.Button(bottom, text="Open PDF", command=self.open_selected_pdf).pack(side="right")
        ttk.Label(bottom, textvariable=self.status_var).pack(side="left")

    def _params(self):
        return {key: var.get().strip() for key, var in self.param_vars.items()}

    def _reset_params(self):
        for key, var in self.param_vars.items():
            var.set(DEFAULT_PARAMS[key])

    def _change_page(self, delta):
        try:
            page = int(self.param_vars["pageno"].get())
        except ValueError:
            page = 1
        self.param_vars["pageno"].set(str(max(1, page + delta)))
        self.fetch()

    def fetch(self):
        scrip = self.scrip_var.get().strip()
        params = self._params()
        save_settings(scrip, params)
        self.fetch_btn.state(["disabled"])
        self.status_var.set(f"Fetching announcements for {scrip}…")

        def worker():
            try:
                result = fetch_announcements(scrip, params)
                self.after(0, self._show_results, result, None)
            except BseApiError as exc:
                self.after(0, self._show_results, None, exc)

        threading.Thread(target=worker, daemon=True).start()

    def _show_results(self, result, error):
        self.fetch_btn.state(["!disabled"])
        self.tree.delete(*self.tree.get_children())
        self.pdf_urls.clear()
        if error:
            self.status_var.set("Error: " + str(error))
            messagebox.showerror("BSE", str(error))
            return
        announcements, total = result
        for ann in announcements:
            url = ann.pdf_url
            item = self.tree.insert(
                "",
                "end",
                values=(ann.date, ann.company, ann.headline or ann.subject, ann.category, "📄 PDF" if url else "—"),
                tags=() if url else ("nopdf",),
            )
            self.pdf_urls[item] = url
        page = self.param_vars["pageno"].get()
        if announcements:
            self.status_var.set(f"{len(announcements)} results on page {page} ({total} total). Click PDF to open.")
        else:
            self.status_var.set(f"No announcements found (page {page}).")

    def _on_click(self, event):
        if self.tree.identify_region(event.x, event.y) != "cell":
            return
        column = self.tree.identify_column(event.x)
        if column == f"#{len(COLUMNS)}":  # PDF column
            item = self.tree.identify_row(event.y)
            if item:
                self._open(item)

    def open_selected_pdf(self):
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo("BSE", "Select a row first.")
            return
        self._open(selection[0])

    def _open(self, item):
        url = self.pdf_urls.get(item)
        if not url:
            messagebox.showinfo("BSE", "This announcement has no PDF attachment.")
            return
        webbrowser.open(url)


def main():
    App().mainloop()


if __name__ == "__main__":
    main()
