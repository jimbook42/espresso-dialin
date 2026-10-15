/** @typedef {{ id: string, isFinished?: boolean, [key: string]: unknown }} BeanRecord */

/**
 * Deep-enough copy of a bean for undo (all persisted fields on the object).
 * @param {BeanRecord | null | undefined} bean
 * @returns {BeanRecord | null}
 */
export function snapshotBeanRecord(bean) {
  if (!bean?.id) return null;
  return { ...bean };
}

/**
 * @param {BeanRecord[]} beans
 * @param {string} finishedBeanId
 * @returns {string}
 */
export function nextActiveBeanIdAfterFinish(beans, finishedBeanId) {
  const remaining = beans.filter((b) => b.id !== finishedBeanId && !b?.isFinished);
  return remaining.length > 0 ? remaining[0].id : '';
}

/**
 * @param {import('dexie').Dexie} database
 * @param {string} beanId
 */
export async function persistBeanFinished(database, beanId) {
  await database.beans.update(beanId, { isFinished: true });
}

/**
 * @param {import('dexie').Dexie} database
 * @param {string} beanId
 */
export async function persistBeanActive(database, beanId) {
  await database.beans.update(beanId, { isFinished: false });
}

/**
 * @param {BeanRecord[]} beans
 * @returns {{ activeBeans: BeanRecord[], finishedBeans: BeanRecord[], finishedCount: number }}
 */
export function partitionBeansByFinished(beans) {
  const activeBeans = [];
  const finishedBeans = [];
  for (const bean of beans) {
    if (bean?.isFinished) finishedBeans.push(bean);
    else activeBeans.push(bean);
  }
  return { activeBeans, finishedBeans, finishedCount: finishedBeans.length };
}

/**
 * @param {import('dexie').Dexie} database
 * @param {BeanRecord} snapshot
 */
export async function restoreBeanFromSnapshot(database, snapshot) {
  await database.beans.put(snapshot);
}
