import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { UnsavedChangesDialog } from "../UnsavedChangesDialog";

describe("UnsavedChangesDialog Component", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <UnsavedChangesDialog
        isOpen={false}
        projectName="Test Project"
        isSaving={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal with project name and action buttons when open", () => {
    render(
      <UnsavedChangesDialog
        isOpen={true}
        projectName="My Film Edit"
        isSaving={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Save changes before closing?")).toBeDefined();
    expect(screen.getByText('"My Film Edit"')).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Don't Save" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  it("invokes onSave callback when Save button is clicked", () => {
    const onSave = vi.fn();
    render(
      <UnsavedChangesDialog
        isOpen={true}
        projectName="Project"
        isSaving={false}
        onSave={onSave}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("invokes onDiscard callback when Don't Save button is clicked", () => {
    const onDiscard = vi.fn();
    render(
      <UnsavedChangesDialog
        isOpen={true}
        projectName="Project"
        isSaving={false}
        onSave={vi.fn()}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Don't Save" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel callback when Cancel button is clicked or Escape is pressed", () => {
    const onCancel = vi.fn();
    render(
      <UnsavedChangesDialog
        isOpen={true}
        projectName="Project"
        isSaving={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("disables buttons and displays saving indicator while isSaving is true", () => {
    render(
      <UnsavedChangesDialog
        isOpen={true}
        projectName="Project"
        isSaving={true}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const discardBtn = screen.getByRole("button", { name: "Don't Save" }) as HTMLButtonElement;
    const saveBtn = screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement;

    expect(cancelBtn.disabled).toBe(true);
    expect(discardBtn.disabled).toBe(true);
    expect(saveBtn.disabled).toBe(true);
  });
});
