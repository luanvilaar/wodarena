-- Corrige o e-mail canônico do owner e atualiza registros históricos dos leads comerciais

UPDATE users
SET email = 'l.vilaar@gmail.com'
WHERE role = 'owner'
  AND LOWER(email) = 'owner@wodarena.com'
  AND NOT EXISTS (
    SELECT 1
    FROM users existing_owner
    WHERE LOWER(existing_owner.email) = 'l.vilaar@gmail.com'
  );

UPDATE commercial_leads
SET owner_email_recipient = 'l.vilaar@gmail.com'
WHERE owner_email_recipient IS NOT NULL
  AND LOWER(owner_email_recipient) = 'owner@wodarena.com';
