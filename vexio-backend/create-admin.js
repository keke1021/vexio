const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

bcrypt.hash('admin1234', 12).then(async function(hash) {
  // Crear el tenant primero
  let tenant = await prisma.tenant.findFirst({
    where: { email: 'ezequiel4600@gmail.com' }
  })

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'SyntraTech',
        email: 'ezequiel4600@gmail.com',
        plan: 'FULL',
        isActive: true,
        slug: 'syntratech'
      }
    })
    console.log('Tenant creado:', tenant.id)
  } else {
    console.log('Tenant ya existía:', tenant.id)
  }

  // Verificar si el usuario ya existe
  const existingUser = await prisma.user.findFirst({
    where: { email: 'ezequiel4600@gmail.com' }
  })

  if (existingUser) {
    console.log('Usuario ya existe, nada que hacer')
  } else {
    await prisma.user.create({
      data: {
        name: 'SyntraTech',
        email: 'ezequiel4600@gmail.com',
        password: hash,
        role: 'SUPERADMIN',
        tenantId: tenant.id
      }
    })
    console.log('Admin creado OK')
  }

  process.exit(0)
}).catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})