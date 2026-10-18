"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

interface DedicatedModelViewerProps {
  geometry: THREE.BufferGeometry | null
  currentLayer?: number
  totalLayers?: number
  color?: string
}

export default function DedicatedModelViewer({
  geometry,
  currentLayer,
  totalLayers,
  color = "#7c3aed",
}: DedicatedModelViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const clippingPlaneRef = useRef<THREE.Plane>(
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 10000)
  )
  const modelHeightRef = useRef<number>(100)
  const layerIndicatorRef = useRef<THREE.LineSegments | null>(null)

  // Update color dynamically
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.color.set(color)
      materialRef.current.needsUpdate = true
    }
  }, [color])

  // Update clipping plane height based on currentLayer / totalLayers
  useEffect(() => {
    const H = modelHeightRef.current
    if (
      totalLayers &&
      totalLayers > 0 &&
      currentLayer !== undefined &&
      currentLayer < totalLayers - 1
    ) {
      const progress = Math.min(1, Math.max(0.01, (currentLayer + 1) / totalLayers))
      const targetY = progress * H
      clippingPlaneRef.current.constant = targetY
      if (layerIndicatorRef.current) {
        layerIndicatorRef.current.position.y = targetY
        layerIndicatorRef.current.visible = true
      }
    } else {
      // Show full model
      clippingPlaneRef.current.constant = 10000
      if (layerIndicatorRef.current) {
        layerIndicatorRef.current.visible = false
      }
    }
  }, [currentLayer, totalLayers])

  useEffect(() => {
    const element = mountRef.current
    if (!element) return

    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(isDark ? "#121214" : "#f8fafc")

    // Camera
    const camera = new THREE.PerspectiveCamera(
      40,
      element.clientWidth / element.clientHeight,
      0.01,
      10000
    )

    // Renderer with local clipping enabled for layer slicing
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(element.clientWidth, element.clientHeight)
    renderer.localClippingEnabled = true
    element.appendChild(renderer.domElement)

    // Lighting
    scene.add(new THREE.HemisphereLight(0xffffff, isDark ? 0x27272a : 0x8892b0, 2.2))
    const mainLight = new THREE.DirectionalLight(0xffffff, 2.4)
    mainLight.position.set(5, 10, 8)
    scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0xffffff, 1.2)
    fillLight.position.set(-6, -2, -6)
    scene.add(fillLight)

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controlsRef.current = controls

    let extent = 100

    if (geometry) {
      geometry.computeVertexNormals()

      // Material with active clipping plane
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.15,
        roughness: 0.45,
        side: THREE.DoubleSide,
        clippingPlanes: [clippingPlaneRef.current],
        clipShadows: true,
      })
      materialRef.current = material

      const mesh = new THREE.Mesh(geometry, material)
      meshRef.current = mesh

      // Measure bounding box & place bottom at Y = 0 (virtual build plate)
      const box = new THREE.Box3().setFromObject(mesh)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())

      modelHeightRef.current = Math.max(size.y, 1)
      mesh.position.set(-center.x, -box.min.y, -center.z)
      scene.add(mesh)

      extent = Math.max(size.x, size.y, size.z, 20)

      // Virtual 3D Printer Bed (Grid)
      const gridSize = Math.max(extent * 2.2, 120)
      const grid = new THREE.GridHelper(
        gridSize,
        24,
        isDark ? 0x8b5cf6 : 0x7c3aed,
        isDark ? 0x27272a : 0xe2e8f0
      )
      grid.position.y = 0
      scene.add(grid)

      // Layer slicing indicator ring
      const boxEdges = new THREE.BoxGeometry(size.x * 1.05, 0.4, size.z * 1.05)
      const edgesGeom = new THREE.EdgesGeometry(boxEdges)
      const indicator = new THREE.LineSegments(
        edgesGeom,
        new THREE.LineBasicMaterial({ color: 0xa78bfa, linewidth: 2 })
      )
      indicator.visible = false
      layerIndicatorRef.current = indicator
      scene.add(indicator)

      // Initial clipping update if currentLayer is set
      if (
        totalLayers &&
        totalLayers > 0 &&
        currentLayer !== undefined &&
        currentLayer < totalLayers - 1
      ) {
        const progress = Math.min(1, Math.max(0.01, (currentLayer + 1) / totalLayers))
        const targetY = progress * size.y
        clippingPlaneRef.current.constant = targetY
        indicator.position.y = targetY
        indicator.visible = true
      } else {
        clippingPlaneRef.current.constant = 10000
        indicator.visible = false
      }

      // Camera positioning
      camera.position.set(extent * 1.35, extent * 1.15, extent * 1.55)
      controls.target.set(0, size.y / 2, 0)
    } else {
      // Empty build plate grid
      const grid = new THREE.GridHelper(140, 20, 0x7c3aed, isDark ? 0x27272a : 0xe2e8f0)
      scene.add(grid)
      camera.position.set(110, 90, 130)
      controls.target.set(0, 0, 0)
    }

    camera.near = extent / 1000
    camera.far = extent * 100
    camera.updateProjectionMatrix()
    controls.update()

    // Render loop
    let frameId = 0
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || !element.clientHeight) return
      camera.aspect = element.clientWidth / element.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(element.clientWidth, element.clientHeight)
    })
    observer.observe(element)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      if (meshRef.current) {
        meshRef.current.geometry.dispose()
        materialRef.current?.dispose()
      }
    }
  }, [geometry])

  return (
    <div
      ref={mountRef}
      className="relative size-full min-h-[340px] overflow-hidden rounded-xl bg-muted/20"
      aria-label="Interactive 3D STL Model Viewer with Layer Tracing"
      role="img"
    />
  )
}
