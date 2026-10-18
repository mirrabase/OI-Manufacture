"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GCodeLoader } from "three/examples/jsm/loaders/GCodeLoader.js"
import { fetchRfqObject } from "@/lib/firebase/api"

export default function GcodePreview({ path, asManufacturer = false }: { path: string; asManufacturer?: boolean }) {
  const mount = useRef<HTMLDivElement>(null)
  const model = useRef<THREE.Group | null>(null)
  const [layer, setLayer] = useState(0)
  const [layers, setLayers] = useState(0)
  const [error, setError] = useState("")
  useEffect(() => {
    const element = mount.current
    if (!element) return
    let cancelled = false
    let cleanup: (() => void) | undefined
    setError(""); setLayers(0)
    void (async () => {
      const bytes = await fetchRfqObject(path, asManufacturer)
      if (cancelled) return
      const loader = new GCodeLoader()
      loader.splitLayer = true
      const group = loader.parse(new TextDecoder().decode(bytes))
      const count = group.children.length / 2
      if (!count) throw new Error("No printable layers in this preview.")
      model.current = group
      group.rotation.x = -Math.PI / 2
      for (const child of group.children) {
        const line = child as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
        line.visible = line.material.name !== "path"
        if (line.visible) line.material.color.set(0x7c3aed)
      }
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(getComputedStyle(document.documentElement).colorScheme === "dark" ? "#18181b" : "#f4f4f5")
      scene.add(group)
      group.updateMatrixWorld(true)
      const box = new THREE.Box3()
      for (const child of group.children) if (child.visible) box.expandByObject(child)
      const size = box.getSize(new THREE.Vector3())
      group.position.sub(box.getCenter(new THREE.Vector3()))
      const extent = Math.max(size.x, size.y, size.z, 1)
      const camera = new THREE.PerspectiveCamera(42, element.clientWidth / 288, extent / 1000, extent * 100)
      camera.position.set(extent * 1.2, extent, extent * 1.5)
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(element.clientWidth, 288)
      element.appendChild(renderer.domElement)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      let frame = 0
      const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera) }
      render()
      const observer = new ResizeObserver(() => {
        if (!element.clientWidth) return
        camera.aspect = element.clientWidth / 288
        camera.updateProjectionMatrix()
        renderer.setSize(element.clientWidth, 288)
      })
      observer.observe(element)
      setLayers(count); setLayer(count - 1)
      cleanup = () => {
        cancelAnimationFrame(frame); observer.disconnect(); controls.dispose()
        const materials = new Set<THREE.Material>()
        group.children.forEach((child) => { const line = child as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; line.geometry.dispose(); materials.add(line.material) })
        materials.forEach((material) => material.dispose())
        renderer.dispose(); renderer.domElement.remove(); model.current = null
      }
    })().catch(() => { if (!cancelled) setError("Could not load the sliced preview. Try reopening it; your request is still saved.") })
    return () => { cancelled = true; cleanup?.() }
  }, [path, asManufacturer])
  useEffect(() => {
    for (const child of model.current?.children ?? []) {
      const line = child as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
      line.visible = line.material.name !== "path" && Number(line.name.replace("layer", "")) <= layer
    }
  }, [layer])
  return <div className="grid gap-2">
    <div ref={mount} role="img" aria-label="Sliced toolpath preview; drag to rotate and scroll to zoom" className="h-72 overflow-hidden rounded-lg border" />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : layers ? <label className="grid gap-2 text-sm">Layer {layer + 1} / {layers}<input aria-label="Visible print layers" type="range" min="0" max={layers - 1} value={layer} onChange={(event) => setLayer(Number(event.target.value))} /></label> : <p className="text-sm text-muted-foreground">Loading sliced layers…</p>}
  </div>
}
