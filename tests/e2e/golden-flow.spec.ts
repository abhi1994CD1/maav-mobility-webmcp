import { expect, test } from "@playwright/test";

test("complete human-governed fallback workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SIMULATED OPERATIONS")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mobility Command" })).toBeVisible();
  await expect(page.getByText("AUTHORED MAP + ROUTE FALLBACK")).toBeVisible();

  await page.getByRole("button", { name: "Activate disruption" }).click();
  await expect(page.getByText("INCIDENT ACTIVE")).toBeVisible();

  await page.getByRole("button", { name: /Evaluate recovery options|Manual evaluation fallback/ }).click();
  await expect(page.getByText("Recovery comparison")).toBeVisible();
  await expect(page.getByText("Coordinated recovery")).toBeVisible();

  await page.getByRole("button", { name: "Stage" }).click();
  await expect(page.getByText("Human decision gate")).toBeVisible();
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByText("APPROVAL RECORDED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Commit approved recovery|Manual commit fallback/ }).click();
  await expect(page.getByText("RECOVERED", { exact: true })).toBeVisible();
  await expect(page.getByText("96.8%")).toBeVisible();

  const auditDrawer = page.getByRole("dialog", {
    name: "Append-only audit timeline",
  });
  await expect(auditDrawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(auditDrawer).toBeHidden();

  await page.getByRole("button", { name: "Roll back recovery" }).click();
  await expect(page.getByText("ROLLED BACK", { exact: true })).toBeVisible();
  await expect(page.getByText("6 events")).toBeVisible();
});
