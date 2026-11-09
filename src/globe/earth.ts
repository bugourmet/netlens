import * as THREE from 'three';

// The planet itself: real-sun lighting, night lights, seas and a starfield. No app data in here.

/** Where the sun is overhead at time t (unix seconds), as a unit vector in globe space. Accurate to well under a degree. */
export function sunDirection(t: number) {
  const d = new Date(t * 1000);
  const dayOfYear = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const b = ((2 * Math.PI) / 364) * (dayOfYear - 81);
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const lng = -(utcHours - 12) * 15 - equationOfTime / 4;
  // Same lat/lng to xyz convention as three-globe.
  const phi = ((90 - declination) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
}

const vertexShader = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform vec3 sunDir;
  uniform float sunlit;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float d = dot(n, sunDir);
    float dayAmount = smoothstep(-0.07, 0.2, d) * sunlit;

    // Day side stays dark and desaturated so arcs and labels keep reading on top of it.
    vec3 raw = texture2D(dayMap, vUv).rgb;
    float gray = dot(raw, vec3(0.3, 0.59, 0.11));
    vec3 day = mix(vec3(gray), raw, 0.45);
    day = pow(day, vec3(1.9)) * vec3(0.66, 0.74, 0.8);
    day = day / (1.0 + day * 4.0); // keeps ice and desert from blowing out
    day *= 0.12 + 0.68 * max(d, 0.0);

    // The night photo has a blue cast, so keep only actual lights and darken the sea.
    float water = texture2D(waterMap, vUv).r;
    vec3 nightRaw = texture2D(nightMap, vUv).rgb;
    float glow = smoothstep(0.06, 0.4, dot(nightRaw, vec3(0.5, 0.4, 0.1)));
    vec3 lights = pow(nightRaw, vec3(1.15)) * vec3(2.3, 1.6, 0.95) * glow;
    vec3 base = mix(vec3(0.012, 0.024, 0.03), vec3(0.003, 0.012, 0.02), water);
    vec3 night = lights * (1.0 - water * 0.75) + base;
    vec3 color = mix(night, day, dayAmount);

    // Deep blue seas on the day side, with a soft sheen toward the sun.
    vec3 h = normalize(sunDir + v);
    float sheen = pow(max(dot(n, h), 0.0), 24.0);
    color += water * vec3(0.012, 0.042, 0.07) * (0.5 + sheen * 1.6) * dayAmount;

    // Atmosphere scattering at the limb.
    float rim = pow(1.0 - max(dot(n, v), 0.0), 4.2);
    color += vec3(0.14, 0.6, 0.9) * rim * (0.08 + 0.3 * max(d + 0.25, 0.0) * sunlit);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface EarthLight {
  /** Unit vector toward the sun. Update with sunDirection(). */
  sunDir: { value: THREE.Vector3 };
  /** 1 for real day and night, 0 for permanent night. */
  sunlit: { value: number };
}

/** Earth material using textures under `${base}textures/`. See THIRD_PARTY_NOTICES.md for their sources. */
export function createEarthMaterial(base: string): { material: THREE.ShaderMaterial; light: EarthLight } {
  const loader = new THREE.TextureLoader();
  const texture = (name: string) => {
    const t = loader.load(`${base}textures/${name}`);
    t.anisotropy = 8;
    return t;
  };
  const light: EarthLight = { sunDir: { value: sunDirection(Date.now() / 1000) }, sunlit: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { dayMap: { value: texture('earth-day.jpg') }, nightMap: { value: texture('earth-night.jpg') }, waterMap: { value: texture('earth-water.png') }, ...light },
  });
  return { material, light };
}

/** A sphere of faint points far outside the globe. Fixed in space, so it turns with the camera. */
export function createStars(count = 2200) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = 1500 + Math.random() * 600;
    const s = Math.sqrt(1 - u * u);
    positions.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3);
    const brightness = 0.25 + Math.pow(Math.random(), 3) * 0.75;
    const warmth = Math.random();
    colors.set([brightness * (warmth > 0.8 ? 1 : 0.8), brightness * 0.88, brightness * (warmth < 0.3 ? 1 : 0.82)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  return new THREE.Points(geometry, material);
}
