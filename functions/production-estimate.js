const { HttpsError } = require("firebase-functions/v2/https")

async function getCustomerProductionLeadTime({
  db,
  uid,
  organizationId,
  materialName,
  process,
  dimensionsMm,
  plannedHours,
}) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to estimate production availability.")
  if (
    typeof organizationId !== "string" || !organizationId
    || typeof materialName !== "string" || !materialName.trim()
    || typeof process !== "string" || !process.trim()
    || !Array.isArray(dimensionsMm) || dimensionsMm.length !== 3
    || !dimensionsMm.every((value) => Number.isFinite(value) && value > 0 && value <= 2000)
    || !Number.isFinite(plannedHours) || plannedHours <= 0 || plannedHours > 10000
  ) {
    throw new HttpsError("invalid-argument", "Production requirements are invalid.")
  }

  const organization = await db.doc(`organizations/${organizationId}`).get()
  if (!organization.exists || organization.data().active !== true || organization.data().acceptingRequests !== true) {
    return { leadTimeDays: null }
  }

  const [materials, equipment] = await Promise.all([
    db.collection("materials").where("organizationId", "==", organizationId).get(),
    db.collection("equipment").where("organizationId", "==", organizationId).get(),
  ])
  const requestedMaterial = materialName.trim().toLowerCase()
  const materialIds = new Set(materials.docs.filter((item) => {
    const name = String(item.data().name || "").toLowerCase()
    return requestedMaterial === "not sure" || name === requestedMaterial || name.startsWith(`${requestedMaterial} `)
  }).map((item) => item.id))
  const part = [...dimensionsMm].sort((left, right) => right - left)
  const productionDays = (hours, capacity) => Math.max(1, Math.ceil(hours / capacity))
  const leadTimes = equipment.docs.flatMap((item) => {
    const machine = item.data()
    const volume = Array.isArray(machine.buildVolumeMm) ? [...machine.buildVolumeMm].sort((left, right) => right - left) : []
    const supportsProcess = process === "Not sure" || machine.technology === process || (process === "SLA" && machine.technology === "MSLA")
    if (
      machine.status === "Maintenance" || machine.status === "Offline"
      || !Number.isFinite(machine.workingHours) || machine.workingHours <= 0
      || !Array.isArray(machine.compatibleMaterialIds) || !machine.compatibleMaterialIds.some((id) => materialIds.has(id))
      || !supportsProcess || volume.length !== 3
      || part.some((dimension, index) => dimension > volume[index])
    ) return []
    const queueDays = Math.ceil(Math.max(0, Number(machine.scheduledHours) || 0) / machine.workingHours)
    return [queueDays + productionDays(plannedHours, machine.workingHours)]
  })

  return { leadTimeDays: leadTimes.length ? Math.min(...leadTimes) : null }
}

module.exports = { getCustomerProductionLeadTime }
