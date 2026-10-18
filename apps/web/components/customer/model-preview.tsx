"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

export default function ModelPreview({ geometry }: { geometry: THREE.BufferGeometry }) {
  const mount = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = mount.current
    if (!element) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(getComputedStyle(document.documentElement).colorScheme === "dark" ? "#18181b" : "#f4f4f5")
    const camera = new THREE.PerspectiveCamera(42, element.clientWidth / element.clientHeight, 0.01, 10000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(element.clientWidth, element.clientHeight)
    element.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667085, 2.2))
    const light = new THREE.DirectionalLight(0xffffff, 2)
    light.position.set(3, 5, 7)
    scene.add(light)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.08, roughness: 0.55, side: THREE.DoubleSide }))
    mesh.geometry.computeVertexNormals()
    scene.add(mesh)
    const box = new THREE.Box3().setFromObject(mesh)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    mesh.position.sub(center)
    const maxDimension = Math.max(size.x, size.y, size.z, 1)
    camera.position.set(maxDimension * 1.5, maxDimension * 1.3, maxDimension * 1.8)
    camera.near = maxDimension / 1000
    camera.far = maxDimension * 100
    camera.updateProjectionMatrix()
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)
    controls.update()
    let frame = 0
    const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera) }
    render()
    const observer = new ResizeObserver(() => { if (!element.clientWidth) return; camera.aspect = element.clientWidth / element.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(element.clientWidth, element.clientHeight) })
    observer.observe(element)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); geometry.dispose(); mesh.material.dispose(); renderer.dispose(); renderer.domElement.remove() }
  }, [geometry])
  return <div ref={mount} aria-label="Interactive STL preview; drag to rotate and scroll to zoom" role="img" className="h-72 overflow-hidden rounded-xl border" />
}
