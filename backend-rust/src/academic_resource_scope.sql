(__ROLE__::text='admin' OR __ALIAS__.__AUTHOR__ IS NULL OR __ALIAS__.__AUTHOR__=__PROFILE__
 OR EXISTS(SELECT 1 FROM accounts_userprofile owner WHERE owner.id=__ALIAS__.__AUTHOR__
   AND (owner.role='admin' OR owner.roles ? 'admin'))
 OR (__ROLE__::text='alumno' AND __ALIAS__.__AUTHOR__=(SELECT assigned_instructor_id
   FROM accounts_userprofile WHERE id=__PROFILE__)))
